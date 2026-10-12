import { runCLI, serve } from './launcher.js';

if (process.argv[2] === '--serve' && process.send) {
  let started = false;
  process.once('disconnect', () => { if (!started) process.exit(1); });
  process.once('message', async options => {
    try {
      const instance = await serve(options);
      started = true;
      process.send({ port: instance.port, version: instance.version });
    } catch (error) {
      process.send({ error: error.code === 'EADDRINUSE' ? 'That port is already in use. Choose another --port.' : error.message });
      process.disconnect(); process.exitCode = 1;
    }
  });
} else {
  runCLI(process.argv.slice(2)).catch(error => {
    console.error(`gh-pull: ${error.code === 'EADDRINUSE' ? 'That port is already in use. Choose another --port.' : error.message}`);
    process.exitCode = 1;
  });
}
