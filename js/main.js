// Point d'entrée : #/join/CODE pour les téléphones, tout le reste pour l'écran animateur.
import { createStore } from './store.js?v=202611221445';

const store = await createStore();

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [view, code] = hash.split('/');
  if (view === 'join') {
    const { startPlayer } = await import('./player.js?v=202611221445');
    return startPlayer(store, code || null);
  }
  const { startHost } = await import('./host.js?v=202611221445');
  return startHost(store, view === 'host' ? code : null);
}

let started = false;
window.addEventListener('hashchange', () => {
  // Un changement de vue recharge la page pour repartir d'un état propre
  if (started) location.reload();
});
await route();
started = true;
