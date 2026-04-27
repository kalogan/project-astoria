import { hasSave, clearSave } from './persistence.js';

export function showMenu() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(10,10,20,0.92)',
      fontFamily: 'monospace', zIndex: '999',
    });

    const title = document.createElement('div');
    Object.assign(title.style, {
      color: '#00d4ff', fontSize: '32px',
      letterSpacing: '6px', marginBottom: '48px',
    });
    title.textContent = 'PROJECT ASTORIA';

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

    const btnNew  = btn('NEW GAME', '#ff4444');
    const btnCont = btn('CONTINUE', '#00d4ff');

    btnNew.addEventListener('click', () => {
      clearSave();
      overlay.remove();
      resolve('new');
    });

    btnCont.addEventListener('click', () => {
      overlay.remove();
      resolve('continue');
    });

    overlay.appendChild(title);
    overlay.appendChild(btnNew);
    if (hasSave()) overlay.appendChild(btnCont);

    document.body.appendChild(overlay);
  });
}
