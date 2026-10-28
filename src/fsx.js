import fs from 'node:fs';

// Write to a temp file and rename it over the target, so a reader never sees half a file.
// On Windows the rename fails (EPERM/EBUSY) while another process has the target open
// for reading, as the dashboard often does: wait a moment and try again.
export function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || i >= 40) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
