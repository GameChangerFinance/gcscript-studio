import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/studio.css';
import { getConfig } from './config';
import { captureWalletReturn } from './adapters/wallet/bridge';
import { createStudioController } from './app/controller';
import { App } from './app/App';
import { errorMessage } from './core/json';
import { readStudioLaunch } from './core/project/edit-link';
import { sessionConfig } from './adapters/persistence';

async function main(): Promise<void> {
  const target = document.getElementById('root');
  if (!target) throw Error('Missing application root');
  const defaults = await getConfig();
  const baseURL = new URL(import.meta.env.BASE_URL, location.origin).href;
  const config = sessionConfig(
    defaults,
    readStudioLaunch(location.href, baseURL, defaults).embedded,
  );
  let captureError = '';
  try {
    if (await captureWalletReturn(config)) {
      target.textContent = 'Wallet exports saved. You can close this popup.';
      return;
    }
  } catch (error) {
    captureError = errorMessage(error);
  }
  const controller = createStudioController(config);
  createRoot(target).render(<App controller={controller} />);
  window.addEventListener('pagehide', () => controller.dispose(), { once: true });
  await controller.loadSchema(controller.store.getSnapshot().options.schemaUrl).catch(() => {});
  await controller.importEditLink(location.href);
  if (captureError) controller.notify('Wallet return: ' + captureError, true);
}
void main().catch((error) => {
  const target = document.getElementById('root');
  if (target) target.textContent = 'Studio could not start: ' + errorMessage(error);
});
