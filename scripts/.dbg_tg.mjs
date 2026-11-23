import { buildTrackData } from '../src/track/track.js';
import { tradgarden } from '../src/level/tradgarden.js';
const T = buildTrackData(tradgarden.track);
const ys=T.pts.map(p=>p.y); let climb=0,maxG=0; for(let i=1;i<T.N;i++){const d=T.pts[i].y-T.pts[i-1].y; if(d>0)climb+=d; maxG=Math.max(maxG,Math.abs(d)/0.6);}
console.log('len',T.length.toFixed(0),'y',Math.min(...ys).toFixed(2),Math.max(...ys).toFixed(2),'klätt',climb.toFixed(1),'maxlut',(maxG*100).toFixed(0),'kors',T.crossings,'bro',T.isBridge.filter(Boolean).length,'cp',T.checkpoints.length,'dos',Math.max(...T.bank.map(Math.abs))*57.3|0);
