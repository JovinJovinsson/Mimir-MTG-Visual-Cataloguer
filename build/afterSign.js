// Notarizes the macOS app when Apple credentials are present in the environment.
// In dev builds (no credentials) this is a no-op.
const { notarize } = require('@electron/notarize');

async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping notarization — APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set');
    return;
  }

  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath} …`);
  await notarize({ appPath, appleId, appleIdPassword, teamId });
  console.log('Notarization complete');
}

module.exports = afterSign;
