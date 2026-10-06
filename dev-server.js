// Local dev server: static files + /api/* as Vercel-style handlers.
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const TYPES={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.json':'application/json'};
http.createServer(async (req,res)=>{
  const u=url.parse(req.url); let p=decodeURIComponent(u.pathname);
  if(p.startsWith('/api/')){
    const file=path.join(__dirname,p.replace(/\/$/,''))+'.js';
    if(!fs.existsSync(file)){res.writeHead(404).end('no handler');return;}
    let body='';req.on('data',c=>body+=c);
    req.on('end',async()=>{
      const handler=require(file);
      req.body=body;
      res.status=c=>{res.statusCode=c;return res};
      res.json=o=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(o));return res};
      try{await handler(req,res)}catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e.message)}))}
    });
    return;
  }
  if(p.endsWith('/'))p+='index.html';
  const f=path.join(__dirname,p);
  if(!fs.existsSync(f)){res.writeHead(404).end('not found');return;}
  res.setHeader('Content-Type',TYPES[path.extname(f)]||'application/octet-stream');
  res.end(fs.readFileSync(f));
}).listen(8900,'127.0.0.1',()=>console.log('dev on 8900'));
