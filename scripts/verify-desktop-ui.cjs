/* oxlint-disable typescript/no-require-imports */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const outputPath = path.resolve(
  process.cwd(),
  'release/verification/tage-desktop-smoke.png',
);
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function verify() {
  const errors = [];
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    backgroundColor: '#05080d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) errors.push(message);
  });
  window.webContents.on(
    'did-fail-load',
    (_event, code, description, validatedUrl) => {
      errors.push(String(code) + ' ' + description + ' ' + validatedUrl);
    },
  );

  await window.loadFile(
    path.resolve(process.cwd(), 'dist-desktop/index.html'),
  );
  await wait(2500);

  const createMode = await window.webContents.executeJavaScript(
    [
      '(() => {',
      'const text = document.body.innerText.trim();',
      "const joinButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Entrar com código'));",
      "const visible = text.includes('Criar equipe') && text.includes('Nome da equipe ou empresa');",
      'joinButton?.click();',
      'return visible;',
      '})()',
    ].join('\n'),
  );
  await wait(200);

  const result = await window.webContents.executeJavaScript(
    [
      '(() => {',
      'const text = document.body.innerText.trim();',
      "const overlay = document.querySelector('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay');",
      "const password = document.querySelector('input[type=\"password\"]');",
      "const betaVisible = text.toLocaleLowerCase('pt-BR').includes('versão beta');",
      "const accessVisible = text.includes('Acesse sua operação') && text.includes('Código da equipe') && text.includes('Entrar no Tage');",
      'return { title: document.title, textLength: text.length,',
      'overlay: overlay ? overlay.textContent : null,',
      'passwordMasked: Boolean(password), betaVisible, accessVisible };',
      '})()',
    ].join('\n'),
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const image = await window.webContents.capturePage();
  fs.writeFileSync(outputPath, image.toPNG());

  const consoleErrors = errors.filter(
    (message) =>
      !message.includes('DevTools') &&
      !message.includes('Autofill.enable') &&
      !message.includes('Autofill.setAddresses') &&
      !message.includes('Electron Security Warning'),
  );
  const passed =
    result.textLength > 0 &&
    !result.overlay &&
    result.passwordMasked &&
    createMode &&
    result.betaVisible &&
    result.accessVisible &&
    consoleErrors.length === 0;

  process.stdout.write(
    JSON.stringify(
      { passed, createMode, ...result, consoleErrors, screenshot: outputPath },
      null,
      2,
    ),
  );
  window.destroy();
  app.quit();
  if (!passed) process.exitCode = 1;
}

app.whenReady().then(verify).catch((error) => {
  process.stderr.write(String(error?.stack ?? error));
  app.quit();
  process.exitCode = 1;
});
