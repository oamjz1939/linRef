const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const pathTxt = path.join(electronDir, 'path.txt');
const distDir = path.join(electronDir, 'dist');

function isElectronReady() {
  if (!fs.existsSync(pathTxt)) return false;
  const relPath = fs.readFileSync(pathTxt, 'utf-8').trim();
  if (!relPath) return false;
  return fs.existsSync(path.join(distDir, relPath));
}

if (isElectronReady()) {
  process.exit(0);
}

console.log('Ensuring Electron binary is installed...');
try {
  childProcess.execFileSync(process.execPath, [path.join(electronDir, 'install.js')], {
    stdio: 'inherit'
  });
} catch {
  // Ignore and check below
}

if (!isElectronReady() && process.platform === 'darwin') {
  const home = process.env.HOME || '';
  const cacheDir = path.join(home, 'Library', 'Caches', 'electron');
  if (fs.existsSync(cacheDir)) {
    const subdirs = fs.readdirSync(cacheDir);
    for (const sub of subdirs) {
      const subPath = path.join(cacheDir, sub);
      if (fs.statSync(subPath).isDirectory()) {
        const zips = fs.readdirSync(subPath).filter((f) => f.endsWith('.zip'));
        if (zips.length > 0) {
          const zipFile = path.join(subPath, zips[0]);
          fs.rmSync(distDir, { recursive: true, force: true });
          fs.mkdirSync(distDir, { recursive: true });
          childProcess.execFileSync('ditto', ['-x', '-k', zipFile, distDir]);
          fs.writeFileSync(pathTxt, 'Electron.app/Contents/MacOS/Electron', 'utf-8');
          break;
        }
      }
    }
  }
}
