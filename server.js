import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 3000);
const MAX_PEOPLE = Math.max(2, Math.min(12, Number(process.env.MAX_PEOPLE || 6)));
const rooms = new Map();
const BLOCKED_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const text = (value, max=80) => String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max);
const makeId = (bytes=4) => randomBytes(bytes).toString('hex');
const sendJson = (res, status, body) => {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(body));
};
const fail = (res, status, message) => sendJson(res,status,{error:message});
const parseJson = async (req, max = 64000) => {
  let data='';
  for await (const chunk of req) {
    data += chunk.toString();
    if (Buffer.byteLength(data) > max) throw Error('Dados enviados excedem o limite permitido.');
  }
  try {return JSON.parse(data || '{}');} catch {throw Error('JSON inválido.');}
};
const participantPublic = p => ({id:p.id, name:p.name, host:p.host, state:p.state});
const emit = (participant, payload) => {
  if (!participant.response || participant.response.destroyed) return false;
  try {participant.response.write(`data: ${JSON.stringify(payload)}\n\n`);return true;} catch{return false;}
};
const broadcast = (room,payload,exceptId=null) => {
  for (const p of room.participants.values()) if (p.id !== exceptId) emit(p,payload);
};
const validateRoom = id => /^[a-f0-9]{16}$/.test(id || '') && !BLOCKED_NAMES.has(id);
const findParticipant = (room, data) => {
  const p=room?.participants.get(String(data.id || ''));
  return p && p.token === data.token ? p : null;
};
const deleteParticipant = (room,p) => {
  if (!room.participants.has(p.id)) return;
  if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
  if (p.response && !p.response.destroyed) {try{p.response.end();}catch{}}
  room.participants.delete(p.id);
  if (p.host && room.participants.size) room.participants.values().next().value.host = true;
  broadcast(room,{type:'left',id:p.id,participants:[...room.participants.values()].map(participantPublic)});
  if (!room.participants.size) room.emptyAt = Date.now();
};
const getIceServers = () => {
  if (process.env.ICE_SERVERS_JSON) {
    try {const x=JSON.parse(process.env.ICE_SERVERS_JSON);if(Array.isArray(x))return x;}catch{}
  }
  return [{urls:'stun:stun.l.google.com:19302'}, {urls:'stun:stun1.l.google.com:19302'}];
};
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};
async function handler(req,res) {
  const url=new URL(req.url,'http://localhost');
  const pathname=url.pathname;
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Permissions-Policy','camera=(self), microphone=(self), display-capture=(self)');
  // Permite o site publicado no Netlify via variável ALLOWED_ORIGINS.
  // Uma origem por URL completa, separadas por vírgula (sem / final).
  if (pathname.startsWith('/api/')) {
    const origin=req.headers.origin;
    const allowed=(process.env.ALLOWED_ORIGINS || '').split(',').map(x=>x.trim().replace(/\/$/,'')).filter(Boolean);
    const ownOrigin=!origin || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
    const localOrigin=process.env.NODE_ENV!=='production' && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin||'');
    if (origin && !ownOrigin && !localOrigin && !allowed.includes(origin)) return fail(res,403,'Origem não permitida. Adicione o endereço Netlify em ALLOWED_ORIGINS no servidor.');
    res.setHeader('Vary','Origin');
    if(origin) res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    if (pathname==='/api/health' && req.method==='GET') return sendJson(res,200,{ok:true});
    if (pathname==='/api/config' && req.method==='GET') return sendJson(res,200,{iceServers:getIceServers(),maxPeople:MAX_PEOPLE});
    if (pathname==='/api/rooms' && req.method==='GET') {
      const list=[...rooms.values()].filter(r=>r.visibility==='public' && r.participants.size>0 && r.participants.size<MAX_PEOPLE)
        .sort((a,b)=>b.createdAt-a.createdAt).slice(0,35)
        .map(r=>({id:r.id,name:r.name,count:r.participants.size,limit:MAX_PEOPLE,createdAt:r.createdAt}));
      return sendJson(res,200,{rooms:list});
    }
    if (pathname==='/api/rooms' && req.method==='POST') {
      let body;try{body=await parseJson(req,5000);}catch(e){return fail(res,400,e.message);}
      if (rooms.size>=600) return fail(res,503,'Muitas salas ativas. Tente novamente.');
      const name=text(body.name,56) || 'Sala sem nome';
      const visibility=body.visibility==='public'?'public':'private';
      let id;do{id=makeId(8);}while(rooms.has(id));
      rooms.set(id,{id,name,visibility,participants:new Map(),createdAt:Date.now(),emptyAt:Date.now(),chat:[]});
      return sendJson(res,201,{id,name,visibility});
    }
    const match=pathname.match(/^\/api\/rooms\/([a-f0-9]{16})\/(join|events|send|leave|info|resume)$/);
    if (!match) return fail(res,404,'Rota não encontrada.');
    const room=rooms.get(match[1]);
    if (!room) return fail(res,404,'Esta sala não existe ou expirou.');
    const op=match[2];
    if (op==='info' && req.method==='GET') return sendJson(res,200,{id:room.id,name:room.name,visibility:room.visibility,count:room.participants.size,limit:MAX_PEOPLE});
    if (op==='resume' && req.method==='POST') {
      let body;try{body=await parseJson(req,3000);}catch(e){return fail(res,400,e.message);}
      const p=findParticipant(room,body);
      if(!p)return fail(res,401,'Sessão anterior expirada.');
      return sendJson(res,200,{id:p.id,token:p.token,room:{id:room.id,name:room.name,visibility:room.visibility},maxPeople:MAX_PEOPLE});
    }
    if (op==='join' && req.method==='POST') {
      let body;try{body=await parseJson(req,3000);}catch(e){return fail(res,400,e.message);}
      if (room.participants.size>=MAX_PEOPLE) return fail(res,409,'A sala está cheia.');
      const name=text(body.name,22);
      if(name.length<2) return fail(res,400,'Escolha um apelido de pelo menos 2 caracteres.');
      let id;do{id=makeId();}while(room.participants.has(id));
      const p={id,name,token:randomUUID(),host:room.participants.size===0,state:{mic:false,camera:false,screen:false},response:null,disconnectTimer:null,lastSeen:Date.now()};
      room.participants.set(id,p);
      room.emptyAt=null;
      return sendJson(res,200,{id,token:p.token,room:{id:room.id,name:room.name,visibility:room.visibility},maxPeople:MAX_PEOPLE});
    }
    if (op==='events' && req.method==='GET') {
      const p=findParticipant(room,{id:url.searchParams.get('id'),token:url.searchParams.get('token')});
      if(!p) return fail(res,401,'Conexão não autorizada.');
      if(p.disconnectTimer){clearTimeout(p.disconnectTimer);p.disconnectTimer=null;}
      if(p.response && !p.response.destroyed && p.response!==res) try{p.response.end();}catch{}
      const wasConnected=Boolean(p.everConnected);
      p.response=res;p.everConnected=true;
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.write(': conectado\n\n');
      emit(p,{type:'welcome',you:participantPublic(p),room:{id:room.id,name:room.name,visibility:room.visibility},participants:[...room.participants.values()].filter(x=>x.id===p.id || x.response).map(participantPublic),chat:room.chat});
      if(!wasConnected) broadcast(room,{type:'joined',participant:participantPublic(p)},p.id);
      res.on('close',()=>{
        if(p.response!==res)return;
        p.response=null;
        p.disconnectTimer=setTimeout(()=>{if(!p.response)deleteParticipant(room,p);},12000);
        p.disconnectTimer.unref?.();
      });
      return;
    }
    let body;try{body=await parseJson(req,65000);}catch(e){return fail(res,400,e.message);}
    const p=findParticipant(room,body);
    if(!p)return fail(res,401,'Sessão inválida.');
    if(op==='leave' && req.method==='POST'){deleteParticipant(room,p);return sendJson(res,200,{ok:true});}
    if(op==='send' && req.method==='POST') {
      const type=String(body.type||'');
      const now=Date.now();
      if (!p.response) return fail(res,409,'Reconectando à sala.');
      // Approximate burst limiter; keeps a single participant from flooding everyone.
      if(now-(p.rateWindow||0)>1000){p.rateWindow=now;p.rateCount=0;}
      p.rateCount=(p.rateCount||0)+1;
      if(p.rateCount>80)return fail(res,429,'Muitas solicitações.');
      if(type==='signal') {
        const target=room.participants.get(String(body.to||''));
        const data=body.data;
        if(!target || !data || !['call','screen'].includes(data.channel))return fail(res,400,'Sinal inválido.');
        if(data.description && (!['offer','answer'].includes(data.description.type) || typeof data.description.sdp !== 'string' || data.description.sdp.length>45000))return fail(res,400,'Descrição inválida.');
        if(data.candidate && JSON.stringify(data.candidate).length>7000)return fail(res,400,'Candidato inválido.');
        emit(target,{type:'signal',from:p.id,data});
      } else if(type==='chat') {
        const message=text(body.message,1000);
        if(!message)return fail(res,400,'Mensagem vazia.');
        const msg={id:makeId(6),from:p.id,name:p.name,message,time:now};
        room.chat.push(msg);if(room.chat.length>40)room.chat.shift();
        broadcast(room,{type:'chat',message:msg});
      } else if(type==='state') {
        const state=body.state||{};
        p.state={mic:state.mic===true,camera:state.camera===true,screen:state.screen===true};
        broadcast(room,{type:'state',id:p.id,state:p.state});
      } else if(type==='reaction') {
        const choices=['🔥','💜','😂','👏','😮','🎮'];
        if(!choices.includes(body.emoji))return fail(res,400,'Reação inválida.');
        if(now-(p.lastReaction||0)<800)return fail(res,429,'Aguarde um instante.');
        p.lastReaction=now;
        broadcast(room,{type:'reaction',id:p.id,name:p.name,emoji:body.emoji});
      } else return fail(res,400,'Evento desconhecido.');
      return sendJson(res,200,{ok:true});
    }
    return fail(res,405,'Método não permitido.');
  }
  if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);return res.end();}
  const reqPath=pathname==='/'?'/index.html':pathname;
  const file=path.resolve(ROOT, `.${reqPath}`);
  if(!file.startsWith(ROOT+path.sep)) {res.writeHead(403);return res.end();}
  let stats;
  try{stats=await fs.promises.stat(file);}catch{res.writeHead(404);return res.end('Não encontrado');}
  if(!stats.isFile()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'public, max-age=300'});
  if(req.method==='HEAD')return res.end();
  fs.createReadStream(file).pipe(res);
}
const server=http.createServer((req,res)=>{
  handler(req,res).catch(err=>{console.error('Erro de servidor:',err); if(!res.headersSent) fail(res,500,'Falha interna.');else try{res.end();}catch{}});
});
const keepAlive=setInterval(()=>{
  const now=Date.now();
  for(const [id,room] of rooms){
    for (const p of room.participants.values()) {
      if(p.response && !p.response.destroyed)try{p.response.write(': ping\n\n');}catch{}
    }
    if(!room.participants.size && now-(room.emptyAt||room.createdAt)>10*60*1000)rooms.delete(id);
  }
},20000);
keepAlive.unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`uSampas LIVE em http://localhost:${PORT}`));
process.on('SIGTERM',()=>{server.close();process.exit(0);});
