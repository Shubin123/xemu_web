import {Buttons} from './src/xemu-host.js';
const keyboard = {ArrowLeft:Buttons.DPAD_LEFT, ArrowRight:Buttons.DPAD_RIGHT, ArrowUp:Buttons.DPAD_UP,
  ArrowDown:Buttons.DPAD_DOWN, KeyZ:Buttons.A, KeyX:Buttons.B, KeyA:Buttons.X, KeyS:Buttons.Y,
  Enter:Buttons.START, Backspace:Buttons.BACK, Digit1:Buttons.WHITE, Digit2:Buttons.BLACK};
const axisKeys = ['KeyQ','KeyW','KeyI','KeyJ','KeyK','KeyL','KeyT','KeyF','KeyG','KeyH'];
const map = [Buttons.A,Buttons.B,Buttons.X,Buttons.Y,Buttons.WHITE,Buttons.BLACK,0,0,
  Buttons.BACK,Buttons.START,Buttons.LSTICK,Buttons.RSTICK,Buttons.DPAD_UP,Buttons.DPAD_DOWN,
  Buttons.DPAD_LEFT,Buttons.DPAD_RIGHT];
export function installInput(getHost, report) {
  const keys = new Set();
  const touch = new Map();
  const sticks = [[0,0],[0,0]];
  const stage = document.getElementById('touch-controls');
  const mode = document.getElementById('touch-mode');
  let connected = [true,false,false,false], lastHost;
  let lastGamepads = '';
  for (const type of ['keydown','keyup']) window.addEventListener(type, e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (keyboard[e.code] || axisKeys.includes(e.code)) {
      e.preventDefault();
      type === 'keydown' ? keys.add(e.code) : keys.delete(e.code);
    }
  });
  const clear = () => { keys.clear(); touch.clear(); sticks.forEach(s => s.fill(0));
    stage.querySelectorAll('.pressed').forEach(b => b.classList.remove('pressed'));
    stage.querySelectorAll('.touch-stick-knob').forEach(k => k.style.transform = ''); };
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  function cluster(items, stickIndex) {
    const group = document.createElement('div'); group.className='touch-cluster';
    const stick = document.createElement('div'); stick.className='touch-stick';
    stick.setAttribute('role','slider'); stick.setAttribute('aria-label', `${stickIndex ? 'Right' : 'Left'} analog stick`);
    const knob = document.createElement('div'); knob.className='touch-stick-knob'; stick.append(knob);
    let pointer;
    function move(e) { const r=stick.getBoundingClientRect(); const x=(e.clientX-r.left-r.width/2)/(r.width/2);
      const y=(e.clientY-r.top-r.height/2)/(r.height/2); const distance=Math.max(1,Math.hypot(x,y));
      sticks[stickIndex]=[Math.round(x/distance*32767),Math.round(-y/distance*32767)];
      knob.style.transform=`translate(${x/distance*20}px,${y/distance*20}px)`; }
    stick.onpointerdown=e=>{if(pointer!==undefined)return;pointer=e.pointerId;stick.setPointerCapture(pointer);move(e);};
    stick.onpointermove=e=>{if(pointer===e.pointerId)move(e);};
    stick.onpointerup=stick.onpointercancel=stick.onlostpointercapture=e=>{if(pointer===e.pointerId){pointer=undefined;sticks[stickIndex]=[0,0];knob.style.transform='';}};
    group.append(stick);
    for (const [label,bit] of items) {
      const b=document.createElement('button');b.type='button';b.className='touch-button';b.textContent=label;b.setAttribute('aria-label',`Controller ${label}`);
      b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);touch.set(e.pointerId,bit);b.classList.add('pressed');};
      b.onpointerup=b.onpointercancel=b.onlostpointercapture=e=>{touch.delete(e.pointerId);b.classList.remove('pressed');};
      group.append(b);
    }
    return group;
  }
  stage.append(cluster([['↑',Buttons.DPAD_UP],['←',Buttons.DPAD_LEFT],['↓',Buttons.DPAD_DOWN],['→',Buttons.DPAD_RIGHT],['Back',Buttons.BACK],['LT',-1]],0),
    cluster([['Y',Buttons.Y],['X',Buttons.X],['B',Buttons.B],['A',Buttons.A],['Start',Buttons.START],['RT',-2],['White',Buttons.WHITE],['Black',Buttons.BLACK]],1));
  mode.onchange=clear;
  let frames = 0;
  function update() {
    const pads = [...(navigator.getGamepads?.() || [])].slice(0,4);
    const names = pads.filter(Boolean).map(p=>p.id).join(' · ');
    if (names !== lastGamepads) {lastGamepads=names;document.getElementById('gamepad-status').textContent=names||'Keyboard ready. Connect a gamepad to play.';}
    stage.hidden = mode.value==='off' || (mode.value==='auto' && (!matchMedia('(pointer: coarse)').matches || pads.some(Boolean)));
    const host=getHost();
    if (host !== lastHost) {lastHost=host;connected=[true,false,false,false];}
    if (host?.memory) {
      for (let slot=0;slot<4;slot++) {
        const pad=pads[slot]; const present=slot===0||!!pad;
        if (connected[slot]!==present) {connected[slot]=present;host.setPadConnected(slot,present).catch(report);}
        let buttons=0;const axes=[0,0,0,0,0,0];
        if (slot===0) {
          for (const k of keys) buttons|=keyboard[k]||0;
          for (const bit of touch.values()) if(bit>0)buttons|=bit;
          axes[0]=keys.has('KeyQ')||[...touch.values()].includes(-1)?32767:0;
          axes[1]=keys.has('KeyW')||[...touch.values()].includes(-2)?32767:0;
          axes[2]=(Number(keys.has('KeyL'))-Number(keys.has('KeyJ')))*32767;
          axes[3]=(Number(keys.has('KeyI'))-Number(keys.has('KeyK')))*32767;
          axes[4]=(Number(keys.has('KeyH'))-Number(keys.has('KeyF')))*32767;
          axes[5]=(Number(keys.has('KeyT'))-Number(keys.has('KeyG')))*32767;
          for(let i=0;i<4;i++) if(sticks[i>>1][i%2])axes[i+2]=sticks[i>>1][i%2];
        }
        if (pad?.mapping==='standard') {
          pad.buttons.forEach((b,i)=>{if(b.pressed)buttons|=map[i]||0;});
          axes[0]=Math.max(axes[0],Math.round((pad.buttons[6]?.value||0)*32767));
          axes[1]=Math.max(axes[1],Math.round((pad.buttons[7]?.value||0)*32767));
          for(let i=0;i<4;i++) {const value=pad.axes[i]||0;if(Math.abs(value)>.12)axes[i+2]=Math.round(value*32767)*(i%2?-1:1);}
          if (!(frames%6)) { const [l,r]=host.getRumble(slot); if((l||r)&&pad.vibrationActuator)pad.vibrationActuator.playEffect('dual-rumble',{duration:100,strongMagnitude:l/65535,weakMagnitude:r/65535}).catch(()=>{}); }
        }
        host.setPad(slot,{buttons,axes});
      }
    }
    frames++;requestAnimationFrame(update);
  }
  update();
  return clear;
}
