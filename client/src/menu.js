import { hasSaves, clearSave } from './saveSystem.js';
import { showSaveSelect }      from './saveSelectScreen.js';

// Legacy compat: clearSave is no longer used externally but kept as export
export { clearSave };

/**
 * Show the main menu.
 *
 * Resolves to:
 *   'new'                           — start a fresh game
 *   { action:'load', saveId:string} — load an existing save
 */
export function showMenu() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(6,6,14,0.97)',
      fontFamily: 'monospace', zIndex: '999',
    });

    const title = document.createElement('div');
    Object.assign(title.style, {
      color: '#00d4ff', fontSize: '32px',
      letterSpacing: '6px', marginBottom: '14px',
    });
    title.textContent = 'PROJECT ASTORIA';

    const sub = document.createElement('div');
    Object.assign(sub.style, {
      color: '#3a4a6a', fontSize: '11px',
      letterSpacing: '4px', marginBottom: '52px',
    });
    sub.textContent = 'AN ONLINE RPG';

    function btn(label, color) {
      const b = document.createElement('button');
      Object.assign(b.style, {
        background: 'transparent', border: `1px solid ${color}`,
        color, fontFamily: 'monospace', fontSize: '14px',
        letterSpacing: '3px', padding: '12px 32px',
        cursor: 'pointer', marginBottom: '16px', width: '220px',
        transition: 'background 0.15s',
      });
      b.textContent = label;
      b.addEventListener('mouseenter', () => b.style.background = `${color}22`);
      b.addEventListener('mouseleave', () => b.style.background = 'transparent');
      return b;
    }

    const btnNew  = btn('NEW GAME',  '#ff4444');
    const btnCont = btn('CONTINUE',  '#00d4ff');

    btnNew.addEventListener('click', () => {
      overlay.remove();
      resolve('new');
    });

    btnCont.addEventListener('click', async () => {
      // Swap to save select screen without removing this overlay yet
      overlay.style.display = 'none';
      const result = await showSaveSelect();
      if (result.action === 'back') {
        overlay.style.display = 'flex';   // return to main menu
      } else {
        overlay.remove();
        resolve(result);   // { action:'load', saveId }
      }
    });

    overlay.appendChild(title);
    overlay.appendChild(sub);
    overlay.appendChild(btnNew);
    if (hasSaves()) overlay.appendChild(btnCont);

    document.body.appendChild(overlay);
  });
}
