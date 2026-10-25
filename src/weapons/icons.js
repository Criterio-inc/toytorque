// ---------------------------------------------------------------------------
// Vapenikoner ritade på canvas (för vapenrutan i HUD:en). Egna motiv.
// ---------------------------------------------------------------------------

export function drawWeaponIcon(ctx, id, size) {
  const s = size;
  ctx.save();
  ctx.clearRect(0, 0, s, s);
  ctx.translate(s / 2, s / 2);
  ctx.scale(s / 100, s / 100);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const glow = (c) => { ctx.shadowColor = c; ctx.shadowBlur = 14; };
  const ball = (r, inner, outer) => {
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, inner); g.addColorStop(1, outer);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  };
  const bolt = (fill, stroke) => {
    ctx.beginPath();
    ctx.moveTo(8, -40); ctx.lineTo(-20, 6); ctx.lineTo(-2, 6); ctx.lineTo(-10, 40); ctx.lineTo(22, -8); ctx.lineTo(4, -8); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = stroke; ctx.stroke();
  };
  const rocket = (x, y, sc) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.6); ctx.scale(sc, sc);
    ctx.fillStyle = '#d8241c'; ctx.fillRect(-7, -24, 14, 36);
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(-7, -24); ctx.lineTo(0, -38); ctx.lineTo(7, -24); ctx.fill();
    ctx.fillStyle = '#8a5a2b'; ctx.fillRect(-1.5, 12, 3, 22);
    ctx.fillStyle = '#ff8a00'; ctx.beginPath(); ctx.arc(0, 14, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };

  switch (id) {
    case 'shockwave':
      glow('#5fd0ff'); ball(30, '#e8fbff', '#1d7fd8');
      ctx.strokeStyle = '#bff0ff'; ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); ctx.lineTo(Math.cos(a + 0.2) * 42, Math.sin(a + 0.2) * 42); ctx.stroke(); }
      break;
    case 'firework': glow('#ff7a00'); rocket(0, 0, 1.2); break;
    case 'fireworkPack': glow('#ff7a00'); rocket(-18, 6, 0.9); rocket(0, -4, 0.9); rocket(18, 6, 0.9); break;
    case 'electro': glow('#7fd8ff'); bolt('#7fd8ff', '#1a4fb0'); break;
    case 'bomb':
      ball(28, '#666', '#0b0b0b');
      ctx.strokeStyle = '#c8a46a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(14, -22); ctx.quadraticCurveTo(26, -40, 36, -34); ctx.stroke();
      glow('#ffcc00'); ctx.fillStyle = '#ffe14a'; ctx.beginPath(); ctx.arc(36, -34, 6, 0, Math.PI * 2); ctx.fill();
      break;
    case 'oil':
      ctx.fillStyle = '#121212'; ctx.beginPath(); ctx.moveTo(0, -38); ctx.bezierCurveTo(26, -6, 30, 34, 0, 34); ctx.bezierCurveTo(-30, 34, -26, -6, 0, -38); ctx.fill();
      ctx.fillStyle = 'rgba(120,160,255,.5)'; ctx.beginPath(); ctx.ellipse(-9, 8, 5, 10, -0.4, 0, Math.PI * 2); ctx.fill();
      break;
    case 'balloons':
      for (const [x, y, c] of [[-16, 4, '#3aa0ff'], [14, -6, '#5fc8ff'], [0, 14, '#2c7fe0']]) {
        ctx.save(); ctx.translate(x, y); ball(16, '#dff3ff', c); ctx.restore();
      }
      break;
    case 'bearing': ball(30, '#ffffff', '#5d6670'); break;
    case 'turbo':
      ctx.fillStyle = '#1f2a36'; ctx.fillRect(-18, -34, 36, 66);
      ctx.fillStyle = '#9aa4ad'; ctx.fillRect(-8, -40, 16, 7);
      glow('#ffe23a'); ctx.save(); ctx.scale(0.6, 0.6); bolt('#ffe23a', '#a15c00'); ctx.restore();
      break;
    case 'clone':
      ctx.globalAlpha = 0.85; ctx.save(); ctx.scale(0.9, 0.9); bolt('#ff5a3c', '#ffd23f'); ctx.restore(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', 22, 40);
      break;
    case 'star':
      glow('#ffe14a'); ctx.fillStyle = '#ffd400'; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 16 : 38, a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#b97a00'; ctx.stroke();
      break;
    default:
      break;
  }
  ctx.restore();
}

// Pickupens blixt (röd/gul), som textur på ett plan
export function drawPickupBolt(ctx, size) {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / 100, size / 100);
  ctx.beginPath();
  ctx.moveTo(10, -46); ctx.lineTo(-26, 8); ctx.lineTo(-2, 8); ctx.lineTo(-12, 46); ctx.lineTo(28, -10); ctx.lineTo(4, -10); ctx.closePath();
  const g = ctx.createLinearGradient(0, -46, 0, 46);
  g.addColorStop(0, '#ffe14a'); g.addColorStop(1, '#ff3b1f');
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = '#7a1405'; ctx.stroke();
  ctx.restore();
}
