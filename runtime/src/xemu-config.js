// Builds xemu's TOML configuration for the browser core.
//
// The core reads the same config file as desktop xemu (config_spec.yml in the
// xemu tree). Paths refer to the core's virtual filesystem, which the worker
// populates before starting the emulator.

export const CORE_PATHS = Object.freeze({
  dir: '/xemu',
  config: '/xemu/xemu.toml',
  flash: '/xemu/flash.bin',
  mcpx: '/xemu/mcpx.bin',
  eeprom: '/xemu/eeprom.bin',
  hdd: '/hdd/xbox_hdd.qcow2',
  media: '/media',
});

export const DEFAULT_SETTINGS = Object.freeze({
  renderer: 'OPENGL',        // OPENGL (WebGL2) or NULL
  surfaceScale: 1,           // 1..4 render resolution multiplier
  skipBootAnimation: true,
  memory: '64',              // '64' (retail) or '128' (debug kits)
  avpack: 'hdtv',
  useDsp: true,
  hrtf: false,               // Heavy per-voice filtering; off by default on web
  vpWorkers: 2,              // Audio voice processor threads
  hardFpu: true,
  volume: 1.0,
  filtering: 'linear',
});

const quote = value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * @param {object} settings  Subset of DEFAULT_SETTINGS
 * @param {{flash?: boolean, mcpx?: boolean, eeprom?: boolean, hdd?: boolean, disc?: string}} files
 *        Which files the worker has placed at CORE_PATHS, and the disc path.
 */
export function buildConfigToml(settings = {}, files = {}) {
  const s = {...DEFAULT_SETTINGS, ...settings};
  const scale = Math.max(1, Math.min(4, Math.round(Number(s.surfaceScale) || 1)));
  const lines = [
    '[general]',
    'show_welcome = false',
    `skip_boot_anim = ${s.skipBootAnimation ? 'true' : 'false'}`,
    '',
    '[general.updates]',
    'check = false',
    '',
    '[input]',
    'auto_bind = true',
    'allow_vibration = true',
    '',
    '[input.bindings]',
    "port1 = 'web0'",
    "port2 = 'web1'",
    "port3 = 'web2'",
    "port4 = 'web3'",
    '',
    '[display]',
    `renderer = ${quote(s.renderer === 'NULL' ? 'NULL' : 'OPENGL')}`,
    `filtering = ${quote(s.filtering === 'nearest' ? 'nearest' : 'linear')}`,
    '',
    '[display.quality]',
    `surface_scale = ${scale}`,
    '',
    '[audio]',
    `use_dsp = ${s.useDsp ? 'true' : 'false'}`,
    'use_dsp_jit = false',
    `hrtf = ${s.hrtf ? 'true' : 'false'}`,
    `volume_limit = ${Math.max(0, Math.min(1, Number(s.volume)))}`,
    '',
    '[audio.vp]',
    `num_workers = ${Math.max(1, Math.min(8, Math.round(Number(s.vpWorkers) || 1)))}`,
    '',
    '[perf]',
    `hard_fpu = ${s.hardFpu ? 'true' : 'false'}`,
    // The browser has no persistent shader cache directory.
    'cache_shaders = false',
    '',
    '[sys]',
    `mem_limit = ${quote(s.memory === '128' ? '128' : '64')}`,
    `avpack = ${quote(s.avpack)}`,
    '',
    '[sys.files]',
    `flashrom_path = ${quote(files.flash ? CORE_PATHS.flash : '')}`,
    `bootrom_path = ${quote(files.mcpx ? CORE_PATHS.mcpx : '')}`,
    `eeprom_path = ${quote(CORE_PATHS.eeprom)}`,
    `hdd_path = ${quote(files.hdd ? CORE_PATHS.hdd : '')}`,
    `dvd_path = ${quote(files.disc || '')}`,
    '',
  ];
  return lines.join('\n');
}
