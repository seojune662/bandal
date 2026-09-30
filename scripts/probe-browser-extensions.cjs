// Optional isolated evaluation only. Does not install packages into Bandal or ship them.
// First install the two candidate packages in a separate directory; pass its path
// as BANDAL_EXTENSION_PROBE_MODULES. Run this script with Bandal's Electron binary.
const {app,BrowserWindow,WebContentsView,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const probeRequire=require('node:module').createRequire(path.join(process.env.BANDAL_EXTENSION_PROBE_MODULES || '', 'package.json'));
const work=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'bandal-extensions-eval-'));
const {ElectronChromeExtensions}=probeRequire('electron-chrome-extensions');
const {installExtension}=probeRequire('electron-chrome-web-store');
app.setPath('userData',path.join(work,'isolated-data'));
const extensionDir=path.join(work,'fixture');fs.mkdirSync(extensionDir,{recursive:true});
fs.writeFileSync(path.join(extensionDir,'manifest.json'),JSON.stringify({manifest_version:3,name:'Compatibility fixture',version:'1.0',permissions:['storage','tabs','scripting'],host_permissions:['http://127.0.0.1/*'],background:{service_worker:'worker.js'},action:{default_popup:'popup.html'},content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js']}]}));
fs.writeFileSync(path.join(extensionDir,'worker.js'),`chrome.runtime.onMessage.addListener((m,s,reply)=>{chrome.tabs.query({},tabs=>{chrome.storage.local.set({count:tabs.length});reply({tabs:tabs.length,host:tabs[0]?.url,worker:true})});return true});`);
fs.writeFileSync(path.join(extensionDir,'content.js'),`chrome.runtime.sendMessage('probe').then(result=>document.body.dataset.compat=JSON.stringify(result)).catch(e=>document.body.dataset.compat=JSON.stringify({error:String(e)}));`);
fs.writeFileSync(path.join(extensionDir,'popup.html'),`<body>Popup<script src="popup.js"></script>`);
fs.writeFileSync(path.join(extensionDir,'popup.js'),`chrome.storage.local.get('count').then(r=>document.body.dataset.count=r.count);`);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const server=http.createServer((q,r)=>r.end('<html><body>fixture</body></html>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 const win=new BrowserWindow({show:false});
 const output={electron:process.versions.electron,profiles:[]};
 for(const id of ['one','two']){
  const ses=session.fromPartition('persist:test-'+id);
  const bridge=new ElectronChromeExtensions({license:'GPL-3.0',session:ses});
  const view=new WebContentsView({webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});win.contentView.addChildView(view);bridge.addTab(view.webContents,win);bridge.selectTab(view.webContents);
  const extension=await ses.extensions.loadExtension(extensionDir);await view.webContents.loadURL(url+'/'+id);
  let result;for(let i=0;i<50;i++){result=await view.webContents.executeJavaScript('document.body.dataset.compat');if(result)break;await delay(100)}
  const popup=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true}});await popup.loadURL('chrome-extension://'+extension.id+'/popup.html');await delay(100);
  output.profiles.push({id,result:result?JSON.parse(result):null,popupCount:await popup.webContents.executeJavaScript('document.body.dataset.count')});popup.destroy();
 }
 try { const ext=await installExtension('eimadpbcbfnmbkopoojfekhnkhdbieeh',{session:session.fromPartition('persist:test-one'),extensionsPath:path.join(work,'store')});const ses=session.fromPartition('persist:test-one');const view=new WebContentsView({webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});win.contentView.addChildView(view);const bridge=ElectronChromeExtensions.fromSession(ses);bridge.addTab(view.webContents,win);bridge.selectTab(view.webContents);await view.webContents.loadURL(url+'/dark-reader');let dark=false;for(let i=0;i<70;i++){dark=await view.webContents.executeJavaScript('!!document.querySelector("style.darkreader")');if(dark)break;await delay(100)};output.store={installed:!!ext,result:ext?.name??null,version:ext?.version,rendered:dark}  }catch(e){output.store={error:String(e)}}
 console.log(JSON.stringify(output,null,2));fs.writeFileSync(path.join(work,'result.json'),JSON.stringify(output,null,2));console.log('Evaluation artifacts: '+work);server.close();app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
setTimeout(()=>{console.error('probe timeout');app.exit(2)},60000);
