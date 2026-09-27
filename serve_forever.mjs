// WeaveCanvas headless server — v0.7.6 (latest release)
process.env.WEAVE_DATA_DIR = 'E:\\work Buddy\\weave-canvas\\release\\v0.7.6\\WeaveCanvas-win32-x64\\WeaveCanvas-data';
process.env.WEAVE_DIST_DIR = 'E:\\work Buddy\\weave-canvas\\release\\v0.7.6\\WeaveCanvas-win32-x64\\resources\\app\\dist';
const { startServer } = await import('file:///E:/work%20Buddy/weave-canvas/release/v0.7.6/WeaveCanvas-win32-x64/resources/app/server/index.js');
const info = await startServer({ port: 8787 });
console.log('WeaveCanvas v0.7.6 server alive at', info.url);
setInterval(() => {}, 1 << 30); // keep alive
