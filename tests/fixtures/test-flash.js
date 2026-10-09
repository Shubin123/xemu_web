// Generates an original Xbox flash image for engine tests and CPU benchmarks.
//
// Without an MCPX boot ROM, xemu maps the flash's last bytes at the x86 reset
// vector. This image's reset code runs in real mode and:
//   1. prints "XEMUWEB:BOOT\n" to the 0xE9 debug port (-debugcon),
//   2. runs a fixed integer workload (ITERATIONS loop iterations, five
//      instructions each: add, rol, xor, dec, jnz),
//   3. prints "XEMUWEB:DONE <checksum>\n" and halts.
// The checksum is deterministic, so a harness can verify correct execution and
// time BOOT -> DONE to measure emulated instruction throughput.
//
// Pure module (no Node APIs) so test pages can build the image in the browser.

export const FLASH_SIZE = 256 * 1024;
export const DEFAULT_ITERATIONS = 20_000_000;

// Reference model of the workload, used by tests to check the checksum.
export function expectedChecksum(iterations) {
  let eax = 0x12345678 >>> 0, ebx = 0;
  for (let i = 0; i < iterations; i++) {
    ebx = (ebx + eax) >>> 0;
    eax = ((eax << 5) | (eax >>> 27)) >>> 0;
    eax = (eax ^ ebx) >>> 0;
  }
  return ebx;
}

export function buildFlash(iterations = DEFAULT_ITERATIONS) {
  const code = [];
  const labels = {};
  const fixups = [];
  const emit = (...b) => code.push(...b);
  const label = name => { labels[name] = code.length; };
  // rel8 jump to label, patched after assembly
  const rel8 = (opcode, name) => { emit(opcode, 0); fixups.push({at: code.length - 1, name, size: 1}); };
  const imm16Label = name => { emit(0, 0); fixups.push({at: code.length - 2, name, size: 2, abs: true}); };
  const u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

  // Code is placed at linear 0xFFFFFE00; at reset CS base is 0xFFFF0000, so
  // offsets within CS are 0xFE00 + position.
  const ORIGIN = 0xFE00;

  label('start');
  emit(0xFA);                         // cli
  emit(0xFC);                         // cld
  emit(0xBE); imm16Label('msg_boot'); // mov si, msg_boot
  label('print1');
  emit(0x2E, 0xAC);                   // lodsb al, cs:[si]
  emit(0x84, 0xC0);                   // test al, al
  rel8(0x74, 'bench');                // jz bench
  emit(0xE6, 0xE9);                   // out 0xE9, al
  rel8(0xEB, 'print1');               // jmp print1

  label('bench');
  emit(0x66, 0xB9, ...u32(iterations));  // mov ecx, iterations
  emit(0x66, 0xB8, ...u32(0x12345678));  // mov eax, 0x12345678
  emit(0x66, 0x31, 0xDB);                // xor ebx, ebx
  label('loop');
  emit(0x66, 0x01, 0xC3);                // add ebx, eax
  emit(0x66, 0xC1, 0xC0, 0x05);          // rol eax, 5
  emit(0x66, 0x31, 0xD8);                // xor eax, ebx
  emit(0x66, 0x49);                      // dec ecx
  rel8(0x75, 'loop');                    // jnz loop

  emit(0xBE); imm16Label('msg_done');    // mov si, msg_done
  label('print2');
  emit(0x2E, 0xAC);                      // lodsb al, cs:[si]
  emit(0x84, 0xC0);                      // test al, al
  rel8(0x74, 'hex');                     // jz hex
  emit(0xE6, 0xE9);                      // out 0xE9, al
  rel8(0xEB, 'print2');                  // jmp print2

  label('hex');
  emit(0x66, 0x89, 0xDA);                // mov edx, ebx
  emit(0xB9, 0x08, 0x00);                // mov cx, 8
  label('nibble');
  emit(0x66, 0xC1, 0xC2, 0x04);          // rol edx, 4
  emit(0x88, 0xD0);                      // mov al, dl
  emit(0x24, 0x0F);                      // and al, 0x0f
  emit(0x04, 0x30);                      // add al, '0'
  emit(0x3C, 0x39);                      // cmp al, '9'
  emit(0x76, 0x02);                      // jbe +2
  emit(0x04, 0x07);                      // add al, 7 ('A'-'9'-1)
  emit(0xE6, 0xE9);                      // out 0xE9, al
  rel8(0xE2, 'nibble');                  // loop nibble
  emit(0xB0, 0x0A);                      // mov al, '\n'
  emit(0xE6, 0xE9);                      // out 0xE9, al
  label('halt');
  emit(0xF4);                            // hlt
  rel8(0xEB, 'halt');                    // jmp halt

  label('msg_boot');
  emit(...new TextEncoder().encode('XEMUWEB:BOOT\n'), 0);
  label('msg_done');
  emit(...new TextEncoder().encode('XEMUWEB:DONE '), 0);

  for (const f of fixups) {
    const target = labels[f.name];
    if (target === undefined) throw new Error(`Undefined label ${f.name}`);
    if (f.abs) {
      const v = ORIGIN + target;
      code[f.at] = v & 255; code[f.at + 1] = v >>> 8;
    } else {
      const rel = target - (f.at + 1);
      if (rel < -128 || rel > 127) throw new Error(`rel8 out of range to ${f.name}`);
      code[f.at] = rel & 255;
    }
  }
  if (code.length > 0x1F0) throw new Error('Reset code exceeds its 496-byte slot');

  const flash = new Uint8Array(FLASH_SIZE).fill(0xFF);
  const base = FLASH_SIZE - 0x200;            // linear 0xFFFFFE00
  flash.set(code, base);
  // Reset vector at linear 0xFFFFFFF0 (CS:IP = F000:FFF0): jmp near to start.
  const vec = FLASH_SIZE - 0x10;
  const rel16 = (ORIGIN - (0xFFF0 + 3)) & 0xFFFF;
  flash[vec] = 0xE9; flash[vec + 1] = rel16 & 255; flash[vec + 2] = rel16 >>> 8;
  return flash;
}

