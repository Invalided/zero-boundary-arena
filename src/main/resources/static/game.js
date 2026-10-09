(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('game');
  const pendingEntryMode=sessionStorage.getItem('zeroPendingEntryMode');
  if(pendingEntryMode){
    $('menu')?.classList.add('hidden');
    $('mapSelection')?.classList.add('hidden');
    $('loadingScreen')?.classList.remove('hidden');
    if($('loadingStage'))$('loadingStage').textContent='正在切换作战区域';
    if($('loadingProgress'))$('loadingProgress').style.width='8%';
    if($('loadingPercent'))$('loadingPercent').textContent='8%';
  }
  if(new URLSearchParams(location.search).get('capture')==='poster')document.body.classList.add('poster-mode');
  let MAP, MAP_PHYSICS, MAP_IDENTITY, mapCompatible=false,selectedRoomId='polygon-arena',selectedMapMetadata=null,availableMaps=[];
  /**
   * 海报只负责加载阶段的视觉反馈，不加入竞技资源的完成条件。网络慢或图片损坏时，
   * 地图 JSON、武器 GLB 和 Shader 仍按原流程准备，加载层自动保留纯色降级背景。
   */
  function preloadLoadingPoster(metadata){
    if(metadata){$('loadingMapName').textContent=metadata.displayName||'竞技场';$('loadingMapDescription').textContent=metadata.description||'正在部署作战区域';}
    const posterUrl=metadata?.posterUrl;if(!posterUrl)return;
    let absolute;try{absolute=new URL(posterUrl,location.href);}catch{return;}
    if(absolute.origin!==location.origin)return;
    const image=new Image();image.decoding='async';
    image.onload=()=>$('loadingScreen').style.setProperty('--loading-poster',`url(${JSON.stringify(absolute.href)})`);
    image.src=absolute.href;
  }
  /**
   * Web Crypto 在 localhost/HTTPS 下可用，但手机通过局域网 HTTP 访问时可能被禁用。
   * 因此保留一个纯 JS SHA-256 降级路径，两条路径都对地图原始字节计算，
   * 与服务端 MapLoader 保持完全相同的输入。
   */
  async function sha256Hex(bytes){
    if(globalThis.crypto?.subtle){const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');}
    const words=[],bitLength=bytes.length*8,paddedLength=((bytes.length+9+63)>>6)<<6,input=new Uint8Array(paddedLength);input.set(bytes);input[bytes.length]=0x80;
    const view=new DataView(input.buffer);view.setUint32(paddedLength-4,bitLength>>>0);view.setUint32(paddedLength-8,Math.floor(bitLength/0x100000000));
    const constants=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    let hash=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const rotate=(value,count)=>(value>>>count)|(value<<(32-count));
    for(let offset=0;offset<input.length;offset+=64){for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);for(let i=16;i<64;i++){const a=words[i-15],b=words[i-2];words[i]=((rotate(a,7)^rotate(a,18)^(a>>>3))+words[i-16]+(rotate(b,17)^rotate(b,19)^(b>>>10))+words[i-7])|0;}let [a,b,c,d,e,f,g,h]=hash;for(let i=0;i<64;i++){const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+words[i])|0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}hash=[hash[0]+a|0,hash[1]+b|0,hash[2]+c|0,hash[3]+d|0,hash[4]+e|0,hash[5]+f|0,hash[6]+g|0,hash[7]+h|0];}
    return hash.map(value=>(value>>>0).toString(16).padStart(8,'0')).join('');
  }
  try{
    const catalogResponse=await fetch('/api/maps',{cache:'no-cache'});if(!catalogResponse.ok)throw new Error(`地图目录 HTTP ${catalogResponse.status}`);
    const catalog=await catalogResponse.json(),available=catalog.maps||[],requested=new URLSearchParams(location.search).get('room')||localStorage.getItem('neonArenaRoom');availableMaps=available;
    selectedRoomId=available.some(item=>item.roomId===requested)?requested:(catalog.defaultRoomId||available[0]?.roomId);
    if(!selectedRoomId)throw new Error('服务器没有可用地图');
    selectedMapMetadata=available.find(item=>item.roomId===selectedRoomId)||null;preloadLoadingPoster(selectedMapMetadata);
    const selector=$('mapSelect');selector.innerHTML=available.map(item=>`<option value="${item.roomId}">${item.displayName}</option>`).join('');selector.value=selectedRoomId;
    selector.onchange=()=>{localStorage.setItem('neonArenaRoom',selector.value);const url=new URL(location.href);url.searchParams.set('room',selector.value);location.href=url.toString();};
    const response=await fetch(`/api/maps/${encodeURIComponent(selectedRoomId)}`,{cache:'no-cache'});if(!response.ok)throw new Error(`地图 HTTP ${response.status}`);
    const bytes=new Uint8Array(await response.arrayBuffer()),text=new TextDecoder('utf-8').decode(bytes),source=JSON.parse(text);MAP_PHYSICS=MapRuntime.create(source);MAP=MAP_PHYSICS.definition;MAP_IDENTITY={id:String(source.id||''),revision:Number(source.revision??1),contentHash:await sha256Hex(bytes)};
  }catch(error){$('status').textContent=`地图加载失败：${error.message}`;$('status').style.color='#ff647c';return;}
  // welcome 地图身份校验通过前不允许加入，避免用户在连接窗口期间误点。
  $('play').disabled=true;
  $('spectate').disabled=true;
  const BOOTSTRAP_WEAPONS = {
    m4a1:{id:'m4a1',name:'M4A1',category:'ASSAULT_RIFLE',fireMode:'FULL_AUTO',mag:30,movementMultiplier:.96,spread:.018,aimedSpread:.006,kick:7,cooldown:90,reload:2100,verticalRecoil:.006,horizontalRecoil:.0018,pitchRecovery:7.2,yawRecovery:9,heatRecovery:2.15,viewKickScale:.8,fallbackColor:0x35d9ff},
    ak47:{id:'ak47',name:'AK47',category:'ASSAULT_RIFLE',fireMode:'FULL_AUTO',mag:30,movementMultiplier:.93,spread:.025,aimedSpread:.009,kick:10,cooldown:105,reload:2400,verticalRecoil:.015,horizontalRecoil:.006,pitchRecovery:4.6,yawRecovery:5.2,heatRecovery:1.05,viewKickScale:1.25,fallbackColor:0xff6429},
    sniper:{id:'sniper',name:'AWM',category:'SNIPER_RIFLE',fireMode:'SEMI_AUTO',mag:5,movementMultiplier:.86,spread:.035,aimedSpread:.001,kick:15,cooldown:900,reload:1800,retainScopeAfterShot:false,verticalRecoil:.021,horizontalRecoil:.0035,pitchRecovery:5.5,yawRecovery:6,heatRecovery:1.45,viewKickScale:1.7,fallbackColor:0x6e58ff},
    glock:{id:'glock',name:'Glock',category:'PISTOL',slot:'SECONDARY',fireMode:'SEMI_AUTO',mag:17,movementMultiplier:1.03,spread:.022,aimedSpread:.008,kick:5,cooldown:165,reload:1550,verticalRecoil:.009,horizontalRecoil:.0028,pitchRecovery:8.5,yawRecovery:10,heatRecovery:2.4,viewKickScale:.9,fallbackColor:0x37d5b5}
  };

  /**
   * WeaponController 只处理“当前目录里有哪些武器”和通用输入语义。
   * 战斗数值由服务端 welcome 消息覆盖，模型则由独立资产 manifest 提供；两者
   * 使用同一个 weaponId 关联，但不会互相依赖文件格式。
   */
  class WeaponController {
    constructor(bootstrap){this.replace(Object.values(bootstrap));}
    replace(catalog){this.catalog={};catalog.forEach(config=>this.catalog[config.id]={...config});return this.catalog;}
    get(id){return this.catalog[id];}
    isAutomatic(id){return this.get(id)?.fireMode==='FULL_AUTO';}
    weaponForDigit(code,owned,current){
      const slot={Digit1:'PRIMARY',Digit2:'SECONDARY',Digit3:'MELEE'}[code];if(!slot)return null;
      const candidates=Object.values(this.catalog).filter(config=>config.slot===slot&&owned.has(config.id)).map(config=>config.id);if(!candidates.length)return null;
      const index=candidates.indexOf(current);return candidates[(index+1)%candidates.length];
    }
  }
  const weaponController=new WeaponController(BOOTSTRAP_WEAPONS);
  let WEAPONS=weaponController.catalog;
  let ws, id, me, playing = false, dead = false, spectating = false, spectatorMode = 'FREE', spectatorTargetId = null, latestPlayers = [], weapon = 'm4a1', ammo = 30, reserveAmmo = -1, activeTransport = 'netty';
  let entryStateWaiter=null;
  let currentMatch={phase:'WAITING',round:0,remainingMs:0,scoreLimit:20,playerCount:0,minPlayers:1},matchReceivedAt=performance.now(),matchFinished=false,damageIndicatorTimer;
  let buffSelectionDeadline=0,buffSelectionDuration=0,buffSelectionPending=false;
  let suppressPointerUnlock=false,roundStartTimer=0;
  let weaponSkinCatalog={contractVersion:1,defaultsByWeaponId:{},skins:{}},equippedSkins={},equippedSlots={},weaponInventory={};
  let ownedWeapons = new Set(['m4a1']), scoped = false, firing = false, automaticFireAt = 0, aimProgress = 0, aimTarget = 0, spreadKick = 0, recoilImpulse = 0, recoilYaw = 0, aimRecoilPitch = 0, aimRecoilYaw = 0, respawnTimer, worldItems = [],lastGrenadeThrowAt=0,localGrenadeThrowStartedAt=0,throwableEquipped=false,grenadePriming=false,grenadePrimeStartedAt=0;
  // 新的右键瞄准/松开快投是默认交互；经典左键按住版本仍完整保留，可在开发控制台切回。
  const THROWABLE_INPUT_MODE=localStorage.getItem('zeroThrowableInputMode')||'QUICK_LEFT_AIM',CLASSIC_THROW_MODE=THROWABLE_INPUT_MODE==='CLASSIC_LEFT_HOLD',THROW_DURATION_MS=CLASSIC_THROW_MODE?760:560,THROW_COMMIT_MS=CLASSIC_THROW_MODE?380:270;
  const THROWABLES={frag_grenade:{name:'破片手雷',short:'高爆',scaleFactor:1},flash_grenade:{name:'M84 闪光弹',short:'闪光',scaleFactor:7.4},smoke_grenade:{name:'M18 烟雾弹',short:'烟雾',scaleFactor:7.1}};
  let selectedThrowable='frag_grenade',throwableInventory={frag_grenade:0,flash_grenade:0,smoke_grenade:0};
  const DEFAULT_SETTINGS={audio:{musicEnabled:true,musicVolume:.6,sfxEnabled:true,sfxVolume:.8},controls:{mouseSensitivity:1,scopeSensitivity:1,sniperAimMode:'AIM_THEN_FIRE'},training:{botDifficulty:'HARD'}};
  function loadSettings(){try{return JSON.parse(localStorage.getItem('neonArenaSettings'))||structuredClone(DEFAULT_SETTINGS);}catch{return structuredClone(DEFAULT_SETTINGS);}}
  const appSettings=loadSettings();
  appSettings.audio={...DEFAULT_SETTINGS.audio,...appSettings.audio};appSettings.controls={...DEFAULT_SETTINGS.controls,...appSettings.controls};
  appSettings.training={...DEFAULT_SETTINGS.training,...appSettings.training};
  const sniperAimLegacy=localStorage.getItem('neonArenaSniperAimMode');if(sniperAimLegacy)appSettings.controls.sniperAimMode=sniperAimLegacy;
  let sniperAimFireMode=appSettings.controls.sniperAimMode,settingsOpen=false;
  function saveSettings(){localStorage.setItem('neonArenaSettings',JSON.stringify(appSettings));localStorage.setItem('neonArenaSniperAimMode',appSettings.controls.sniperAimMode);}
  function syncSettingsUI(){const set=(id,value)=>{const node=$(id);if(node)node.value=value;};const check=(id,value)=>{const node=$(id);if(node)node.checked=!!value;};check('musicEnabled',appSettings.audio.musicEnabled);check('sfxEnabled',appSettings.audio.sfxEnabled);set('musicVolume',appSettings.audio.musicVolume);set('sfxVolume',appSettings.audio.sfxVolume);set('mouseSensitivity',appSettings.controls.mouseSensitivity);set('scopeSensitivity',appSettings.controls.scopeSensitivity);set('settingsSniperAimMode',appSettings.controls.sniperAimMode);set('settingsBotDifficulty',appSettings.training.botDifficulty);['musicVolume','sfxVolume','mouseSensitivity','scopeSensitivity'].forEach(id=>{const node=$(id),output=$(id+'Value');if(node&&output)output.textContent=id==='mouseSensitivity'||id==='scopeSensitivity'?Number(node.value).toFixed(2):Math.round(Number(node.value)*100)+'%';});}
  /**
   * 浏览器不会告诉 pointerlockchange 是用户按 Esc 还是程序主动退出。所有业务层主动退出
   * 都必须经过这里打标，否则 Buff、死亡或结算弹层会被误判成“用户打开设置”。
   */
  function releaseGamePointerLock(){if(document.pointerLockElement){suppressPointerUnlock=true;document.exitPointerLock();}}
  function setSettingsOpen(open){settingsOpen=!!open;$('settingsPanel').classList.toggle('hidden',!settingsOpen);$('quitGame').classList.toggle('hidden',!playing);$('settingsResume').textContent=playing?'返回战斗':'返回';if(settingsOpen){firing=false;scope(false);Object.keys(keys).forEach(key=>keys[key]=false);releaseGamePointerLock();syncSettingsUI();}else if(playing&&!dead&&$('buffSelection').classList.contains('hidden'))requestGamePointerLock();}
  function quitGame(){if(!playing)return;send({type:'leave'});playing=false;dead=false;spectating=false;matchFinished=false;spectatorMode='FREE';spectatorTargetId=null;document.body.classList.remove('spectator-mode');firing=false;scope(false);hideBuffSelection(false);pendingInputs=[];inputAccumulator=0;renderCorrection.set(0,0,0);Object.keys(keys).forEach(key=>keys[key]=false);clearInterval(respawnTimer);$('death').classList.add('hidden');$('matchResult').classList.add('hidden');$('board').classList.add('hidden');$('hud').classList.add('hidden');$('spectatorHud').classList.add('hidden');$('menu').classList.remove('hidden');$('chatInput').classList.add('hidden');setSettingsOpen(false);}
  const INPUT_INTERVAL = .05;
  let lastPickupAttempt = 0, inputSequence = 0, shotSequence = 0, lastResolvedShotId = 0, jumpRequested = false, inputAccumulator = 0, pingMs = 0;
  const pingSamples=[];
  const lastLocalShotByWeapon = new Map();
  const weaponHeat = new Map();
  let pendingInputs = [];
  const renderCorrection = new THREE.Vector3();
  const keys = {};
  const state = { x: 0, y: 1.7, z: 18, yaw: Math.PI, pitch: 0, vy: 0, onGround: true };
  const savedName = localStorage.getItem('neonArenaName');
  if (savedName) $('name').value = savedName;
  const QUALITY={low:{pixelRatio:.85,shadows:false,lights:2,pickupLights:false,particles:20,stars:false},medium:{pixelRatio:1,shadows:false,lights:3,pickupLights:false,particles:36,stars:true},high:{pixelRatio:1.4,shadows:true,lights:6,pickupLights:true,particles:72,stars:true}};
  const mobileDevice=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;
  let qualityName=localStorage.getItem('neonArenaQuality')||(mobileDevice?'low':'medium'),quality=QUALITY[qualityName]||QUALITY.medium;
  let serverStats='NETTY · PING -- ms · TICK -- ms · QUEUE --',measuredFps=0;

  const frameSamples=[];let correctionCount=0,correctionDistance=0,onePercentLow=0,p99FrameMs=0,longTaskCount=0,longTaskMs=0,lastStateReceivedAt=0,maxSnapshotGapMs=0,deathReconciliationCount=0,lastDamageTaken=null,deathDeadline=0;
  const assetTimings={};
  function recordAssetTiming(name,startedAt){assetTimings[name]=Number((performance.now()-startedAt).toFixed(1));}
  try{if(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask'))new PerformanceObserver(list=>list.getEntries().forEach(entry=>{longTaskCount++;longTaskMs+=entry.duration;})).observe({entryTypes:['longtask']});}catch{}
  const atmosphere=MAP.environment?.atmosphere||{backgroundColor:'#101a31',fogColor:'#10182d',fogNear:42,fogFar:120,ambientSkyColor:'#b8cad5',ambientGroundColor:'#161b1f',ambientIntensity:.95,mainLightColor:'#c7d8e2',mainLightIntensity:1.25,mainLightPosition:[-28,42,-35],celestialColor:'#e9f3ff',celestialPosition:[-42,48,-82],celestialRadius:4.2,stars:true,exposure:1.12};
  const surfacePalette=MAP.environment?.surfacePalette||{concrete:'#3b4658',metal:'#273b55',wood:'#54483d',ramp:'#314b61',guide:'#607080'};
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(atmosphere.backgroundColor);
  scene.fog = new THREE.Fog(atmosphere.fogColor,atmosphere.fogNear,atmosphere.fogFar);
  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, .1, 180);
  scene.add(camera);
  /**
   * 第一人称武器使用独立场景和相机渲染。
   * 关闭深度检测虽能避免穿墙，却会破坏枪身和手臂之间的遮挡关系，产生“半透明”错觉。
   * 因此先渲染世界，再清理深度缓冲并渲染 ViewModel 层。
   */
  const viewModelScene = new THREE.Scene();
  const viewModelCamera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, .03, 20);
  viewModelScene.add(viewModelCamera);
  viewModelScene.add(new THREE.HemisphereLight(0xd8e8ff, 0x20283a, 2.1));
  const viewModelKeyLight=new THREE.DirectionalLight(0xffffff,2.4);viewModelKeyLight.position.set(-2,3,2);viewModelScene.add(viewModelKeyLight);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const graphicsContext=renderer.getContext(),graphicsDebug=graphicsContext.getExtension('WEBGL_debug_renderer_info');
  const graphicsInfo={vendor:graphicsDebug?graphicsContext.getParameter(graphicsDebug.UNMASKED_VENDOR_WEBGL):graphicsContext.getParameter(graphicsContext.VENDOR),renderer:graphicsDebug?graphicsContext.getParameter(graphicsDebug.UNMASKED_RENDERER_WEBGL):graphicsContext.getParameter(graphicsContext.RENDERER)};
  renderer.autoClear = false;
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = atmosphere.exposure;
  if('outputColorSpace' in renderer)renderer.outputColorSpace=THREE.SRGBColorSpace;
  scene.add(new THREE.HemisphereLight(atmosphere.ambientSkyColor,atmosphere.ambientGroundColor,atmosphere.ambientIntensity));
  const moonLight = new THREE.DirectionalLight(atmosphere.mainLightColor,atmosphere.mainLightIntensity);
  moonLight.position.fromArray(atmosphere.mainLightPosition); moonLight.castShadow = quality.shadows; scene.add(moonLight);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(atmosphere.celestialRadius,24,16),new THREE.MeshBasicMaterial({color:atmosphere.celestialColor}));
  moon.position.fromArray(atmosphere.celestialPosition);scene.add(moon);
  const starPositions=[];for(let i=0;i<420;i++){const radius=80+Math.random()*65,angle=Math.random()*Math.PI*2,height=18+Math.random()*70;starPositions.push(Math.cos(angle)*radius,height,Math.sin(angle)*radius);}
  const stars=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:0xcfe5ff,size:.34,sizeAttenuation:true,transparent:true,opacity:.9}));stars.geometry.setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3));stars.visible=!!atmosphere.stars&&quality.stars;scene.add(stars);
  const groundConfig=MAP.environment?.ground||{baseColor:'#30393e',seamColor:'#46545a',speckleColor:'#667277',panelMeters:4,roughness:.82,metalness:.06};
  /**
   * 一张 CanvasTexture 表示一块标准地板面板，纹理重复次数由区域米制尺寸决定。
   * 噪点使用坐标哈希而非 Math.random，保证刷新和录像回放时地面细节不随机跳变。
   */
  function floorPanelTexture(config,width,depth){const surface=document.createElement('canvas');surface.width=surface.height=512;const context=surface.getContext('2d');context.fillStyle=config.baseColor||config.color;context.fillRect(0,0,512,512);context.strokeStyle=config.seamColor;context.lineWidth=8;context.strokeRect(2,2,508,508);context.strokeStyle='#00000038';context.lineWidth=2;context.strokeRect(8,8,496,496);context.fillStyle=config.speckleColor||config.seamColor;for(let y=17;y<512;y+=23)for(let x=11;x<512;x+=29){const hash=(x*73856093^y*19349663)>>>0;if(hash%5===0)context.fillRect((x+hash%13)%506+3,(y+(hash>>>4)%11)%506+3,1+hash%2,1+((hash>>>3)%2));}context.save();context.globalAlpha=.12;context.strokeStyle=config.speckleColor||config.seamColor;context.lineWidth=2;for(let i=0;i<14;i++){const x=(i*97+41)%470+20,y=(i*53+79)%470+20,length=18+(i*17)%54;context.beginPath();context.moveTo(x,y);context.lineTo(Math.min(500,x+length),Math.max(12,y-5+(i%3)*5));context.stroke();}context.restore();const texture=new THREE.CanvasTexture(surface);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;const panel=Math.max(1,Number(config.panelMeters||groundConfig.panelMeters||4));texture.repeat.set(Math.max(1,width/panel),Math.max(1,depth/panel));texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());if('colorSpace'in texture)texture.colorSpace=THREE.SRGBColorSpace;return texture;}
  function floorMaterial(config,width,depth){return new THREE.MeshStandardMaterial({color:0xffffff,map:floorPanelTexture(config,width,depth),roughness:config.roughness,metalness:config.metalness});}
  function groundGeometry(){
    if(MAP.bounds.type!=='POLYGON')return new THREE.PlaneGeometry(MAP.groundSize,MAP.groundSize);
    const shape=new THREE.Shape(),vertices=MAP.bounds.vertices||[];
    // ShapeGeometry 位于 XY 平面，随后绕 X 轴 -90 度；局部 Y 要取 -z 才能保持地图朝向。
    vertices.forEach(([x,z],index)=>index?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }
  const ground = new THREE.Mesh(groundGeometry(),floorMaterial(groundConfig,MAP.bounds.size[0],MAP.bounds.size[2]));
  ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  /** 使用带孔 ShapeGeometry 一次绘制四条区域边框，避免每个矩形额外产生四个 Draw Call。 */
  function floorBorder(width,depth,color){const thickness=.09,shape=new THREE.Shape();shape.moveTo(-width/2,-depth/2);shape.lineTo(width/2,-depth/2);shape.lineTo(width/2,depth/2);shape.lineTo(-width/2,depth/2);shape.closePath();const hole=new THREE.Path();hole.moveTo(-width/2+thickness,-depth/2+thickness);hole.lineTo(-width/2+thickness,depth/2-thickness);hole.lineTo(width/2-thickness,depth/2-thickness);hole.lineTo(width/2-thickness,-depth/2+thickness);hole.closePath();shape.holes.push(hole);const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.62,depthWrite:false}));mesh.rotation.x=-Math.PI/2;mesh.renderOrder=2;return mesh;}
  function floorLabel(label,color){const surface=document.createElement('canvas');surface.width=1024;surface.height=256;const context=surface.getContext('2d');context.clearRect(0,0,1024,256);context.fillStyle=color;context.fillRect(52,190,920,12);context.font='700 88px Arial, sans-serif';context.textAlign='center';context.textBaseline='middle';context.fillText(label,512,112);const texture=new THREE.CanvasTexture(surface);if('colorSpace'in texture)texture.colorSpace=THREE.SRGBColorSpace;const mesh=new THREE.Mesh(new THREE.PlaneGeometry(6.4,1.6),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,opacity:.78,side:THREE.DoubleSide}));mesh.rotation.x=-Math.PI/2;mesh.renderOrder=3;return mesh;}
  (MAP.environment?.floorZones||[]).forEach(zone=>{const [x,z]=zone.center,[width,depth]=zone.size,config={...groundConfig,...zone,baseColor:zone.color};const floor=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),floorMaterial(config,width,depth));floor.rotation.x=-Math.PI/2;floor.position.set(x,.006,z);floor.receiveShadow=true;scene.add(floor);const border=floorBorder(width,depth,zone.accentColor);border.position.set(x,.012,z);scene.add(border);const label=floorLabel(zone.label,zone.accentColor);label.position.set(zone.labelPosition[0],.016,zone.labelPosition[1]);label.rotation.z=zone.rotationY||0;scene.add(label);});
  function floorDecalTexture(definition){const surface=document.createElement('canvas');surface.width=512;surface.height=128;const context=surface.getContext('2d');context.clearRect(0,0,512,128);context.fillStyle=definition.color;if(definition.type==='WARNING_STRIPES'){for(let x=-96;x<576;x+=72){context.beginPath();context.moveTo(x,128);context.lineTo(x+34,0);context.lineTo(x+68,0);context.lineTo(x+34,128);context.closePath();context.fill();}}else{context.lineCap='round';context.lineJoin='round';context.lineWidth=18;context.beginPath();context.moveTo(54,64);context.lineTo(392,64);context.strokeStyle=definition.color;context.stroke();context.beginPath();context.moveTo(350,24);context.lineTo(452,64);context.lineTo(350,104);context.closePath();context.fill();}const texture=new THREE.CanvasTexture(surface);if('colorSpace'in texture)texture.colorSpace=THREE.SRGBColorSpace;return texture;}
  (MAP.environment?.floorDecals||[]).forEach(definition=>{const geometry=new THREE.PlaneGeometry(definition.size[0],definition.size[1]);geometry.rotateX(-Math.PI/2);const decal=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:floorDecalTexture(definition),transparent:true,depthWrite:false,opacity:definition.opacity,side:THREE.DoubleSide}));decal.position.set(definition.center[0],.022,definition.center[1]);decal.rotation.y=definition.rotationY||0;decal.renderOrder=4;scene.add(decal);});
  const obstacleMeshes = [], obstacleMeshesByColliderId = new Map(), bulletHoles = [];
  function box(x, y, z, w, h, d, color = surfacePalette.concrete) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, metalness: .35, roughness: .5, emissive: color, emissiveIntensity: .08 }));
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
    obstacleMeshes.push(mesh); return mesh;
  }
  function rampMesh(value){
    const [ox,oy,oz]=value.origin,alongX=value.forward.endsWith('X'),sign=value.forward.startsWith('POS')?1:-1;
    const center=new THREE.Vector3(ox+(alongX?sign*value.run/2:0),oy+value.rise/2,oz+(alongX?0:sign*value.run/2));
    const slopeLength=Math.hypot(value.run,value.rise);
    const geometry=new THREE.BoxGeometry(alongX?slopeLength:value.width,.12,alongX?value.width:slopeLength);
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:surfacePalette.ramp,metalness:.34,roughness:.58}));
    mesh.position.copy(center);mesh.rotation[alongX?'z':'x']=(alongX?sign:-sign)*Math.atan2(value.rise,value.run);
    mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);obstacleMeshes.push(mesh);return mesh;
  }
  MAP.colliders.forEach(value=>{
    const mesh=value.type==='RAMP'?rampMesh(value):box(value.center[0],value.center[1],value.center[2],value.size[0],value.size[1],value.size[2]);
    mesh.userData.colliderId=value.id;obstacleMeshesByColliderId.set(value.id,mesh);
    mesh.userData.surfaceType=value.surface||'concrete';
    mesh.material.color.set(surfacePalette[mesh.userData.surfaceType]||surfacePalette.concrete);mesh.material.metalness=mesh.userData.surfaceType==='metal'?.65:.12;mesh.material.roughness=mesh.userData.surfaceType==='metal'?.36:.82;
    const guideColor=surfacePalette.guide;
    const guideOpacity=value.type==='BOX'?.3:.75;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:guideColor,transparent:true,opacity:guideOpacity})));
  });
  /**
   * “能源中转站”首版使用共享几何搭建高辨识度设施，避免在布局尚未验证时就引入一整套大型 GLB。
   * 每个圆柱设施都有对应的服务端 BOX 碰撞体；隐藏灰盒后，圆柱仍完全位于碰撞范围内，
   * 不会出现玩家穿过模型或被看不见的远距离碰撞挡住。后续 Blender 资产只需替换这里的外观。
   */
  const energyRelayFallbacks={core:[],coolers:[],relay:[],accents:[]};
  /**
   * three.js r128 的 InstancedMesh 用共享几何体（单个实例、原点附近）的包围球做视锥裁剪，
   * 摄像机一转，整批建筑会被误剔除再突然出现。这里为每个批次建一个共享顶点数据的轻量几何体，
   * 把包围球扩到覆盖全部实例；射线检测时临时换回单实例包围球，保证命中判定不变。
   */
  const _fitBox=new THREE.Box3(),_fitSphere=new THREE.Sphere(),_fitMatrix=new THREE.Matrix4();
  function fitInstancedBounds(batch){
    const base=batch.geometry;if(!base.boundingSphere)base.computeBoundingSphere();
    const geometry=new THREE.BufferGeometry();geometry.index=base.index;
    for(const name in base.attributes)geometry.attributes[name]=base.attributes[name];
    geometry.groups=base.groups;geometry.drawRange=base.drawRange;
    _fitBox.makeEmpty();
    for(let index=0;index<batch.count;index++){batch.getMatrixAt(index,_fitMatrix);_fitSphere.copy(base.boundingSphere).applyMatrix4(_fitMatrix);_fitBox.expandByPoint(_fitSphere.center.clone().addScalar(_fitSphere.radius));_fitBox.expandByPoint(_fitSphere.center.clone().addScalar(-_fitSphere.radius));}
    const fitted=new THREE.Sphere();if(_fitBox.isEmpty())fitted.copy(base.boundingSphere);else _fitBox.getBoundingSphere(fitted);
    const instanceSphere=base.boundingSphere.clone();geometry.boundingSphere=fitted;batch.geometry=geometry;
    const raycast=batch.raycast;batch.raycast=function(raycaster,intersects){geometry.boundingSphere=instanceSphere;try{raycast.call(this,raycaster,intersects);}finally{geometry.boundingSphere=fitted;}};
    return batch;
  }
  function createEnergyRelayStationVisuals(){
    if(MAP.environment?.theme!=='energy_relay_station_day')return;
    const graphite=new THREE.MeshStandardMaterial({color:0x263238,metalness:.72,roughness:.34});
    const panel=new THREE.MeshStandardMaterial({color:0x536269,metalness:.5,roughness:.42});
    const cyan=new THREE.MeshStandardMaterial({color:0x52d8ee,emissive:0x36c9e3,emissiveIntensity:1.7,metalness:.25,roughness:.25});
    const orange=new THREE.MeshStandardMaterial({color:0xef9d3f,emissive:0xd87322,emissiveIntensity:1.35,metalness:.24,roughness:.3});
    const glass=new THREE.MeshStandardMaterial({color:0x8beaff,emissive:0x36c9e3,emissiveIntensity:.8,transparent:true,opacity:.25,roughness:.12,metalness:.08,side:THREE.DoubleSide,depthWrite:false});
    const add=(parent,geometry,material,position,rotation)=>{const value=new THREE.Mesh(geometry,material);value.position.fromArray(position);if(rotation)value.rotation.set(...rotation);value.castShadow=quality.shadows;value.receiveShadow=true;parent.add(value);return value;};
    // 相同设备模块必须走 InstancedMesh。丰富地图不能线性增加 Draw Call，否则低端浏览器会先失去帧率。
    const dummy=new THREE.Object3D();
    const addInstances=(parent,geometry,material,transforms)=>{const batch=new THREE.InstancedMesh(geometry,material,transforms.length);transforms.forEach((transform,index)=>{dummy.position.fromArray(transform.position);dummy.rotation.set(...(transform.rotation||[0,0,0]));dummy.scale.fromArray(transform.scale||[1,1,1]);dummy.updateMatrix();batch.setMatrixAt(index,dummy.matrix);});batch.instanceMatrix.needsUpdate=true;fitInstancedBounds(batch);batch.castShadow=quality.shadows;batch.receiveShadow=true;parent.add(batch);return batch;};
    const hideCollider=id=>{const graybox=obstacleMeshesByColliderId.get(id);if(graybox)graybox.visible=false;};

    const core=new THREE.Group();core.name='EnergyRelayCore';
    add(core,new THREE.CylinderGeometry(3.15,3.35,.8,12),graphite,[0,.4,0]);
    add(core,new THREE.CylinderGeometry(2.55,2.8,.32,12),panel,[0,.96,0]);
    add(core,new THREE.CylinderGeometry(.62,.78,3.55,12),cyan,[0,2.7,0]);
    add(core,new THREE.CylinderGeometry(.96,.96,3.35,16,1,true),glass,[0,2.7,0]);
    const coreRingGeometry=new THREE.TorusGeometry(2.55,.13,8,28);
    add(core,coreRingGeometry,cyan,[0,1.18,0],[Math.PI/2,0,0]);
    add(core,coreRingGeometry,cyan,[0,4.35,0],[Math.PI/2,0,0]);
    const strutGeometry=new THREE.BoxGeometry(.24,3.2,.24);
    addInstances(core,strutGeometry,panel,[[1.55,2.55,1.55],[-1.55,2.55,1.55],[1.55,2.55,-1.55],[-1.55,2.55,-1.55]].map(position=>({position})));
    scene.add(core);energyRelayFallbacks.core.push(core);['energy-core-base','energy-core-cell','energy-core-strut-ne','energy-core-strut-nw','energy-core-strut-se','energy-core-strut-sw'].forEach(hideCollider);

    // The maintenance ring is gameplay geometry, not decoration around the GLB.
    // Four low PLATFORM colliders keep it authoritative while shared batches keep the WebGL cost fixed.
    const maintenanceConcrete=new THREE.MeshStandardMaterial({color:0x73797b,metalness:.04,roughness:.9});
    const hazard=new THREE.MeshStandardMaterial({color:0xe2b541,emissive:0x6d4b08,emissiveIntensity:.22,metalness:.18,roughness:.55});
    const ringIds=['core-ring-north','core-ring-south','core-ring-east','core-ring-west'];
    const ringDefinitions=ringIds.map(id=>MAP.colliders.find(value=>value.id===id)).filter(Boolean);
    const unitBox=new THREE.BoxGeometry(1,1,1);
    addInstances(scene,unitBox,maintenanceConcrete,ringDefinitions.map(value=>({position:value.center,scale:value.size})));
    const ringEdges=ringDefinitions.flatMap(value=>{
      const [x,y,z]=value.center,[width,height,depth]=value.size,horizontal=width>depth;
      return horizontal?[-1,1].map(side=>({position:[x,y+height/2+.025,z+side*(depth/2-.1)],scale:[width-.25,.05,.16]})):
        [-1,1].map(side=>({position:[x+side*(width/2-.1),y+height/2+.025,z],scale:[.16,.05,depth-.25]}));
    });
    addInstances(scene,unitBox,hazard,ringEdges);
    ringIds.forEach(hideCollider);

    // Embedded bus ducts visually connect the reactor to maintenance and storage zones without adding collision.
    const conduitGeometry=new THREE.BoxGeometry(1,.08,.34);
    addInstances(scene,conduitGeometry,cyan,[{position:[-11.4,.07,0],scale:[15.8,1,1]}]);
    addInstances(scene,conduitGeometry,orange,[{position:[11.4,.07,0],scale:[15.8,1,1]}]);
    const consoleBodies=[[-2.72,1.18,0],[2.72,1.18,0]].map(position=>({position,scale:[.42,.7,1.15]}));
    addInstances(scene,unitBox,graphite,consoleBodies);
    addInstances(scene,new THREE.BoxGeometry(.08,.45,.78),cyan,[{position:[-2.49,1.32,0]}]);
    addInstances(scene,new THREE.BoxGeometry(.08,.45,.78),orange,[{position:[2.49,1.32,0]}]);
    const valveGeometry=new THREE.TorusGeometry(.28,.055,7,14);
    addInstances(scene,valveGeometry,hazard,[
      {position:[-4.9,.54,0],rotation:[0,Math.PI/2,0]},
      {position:[4.9,.54,0],rotation:[0,Math.PI/2,0]}
    ]);

    const coolerBodyGeometry=new THREE.CylinderGeometry(.8,.96,3.15,12);
    const coolerRingGeometry=new THREE.TorusGeometry(.9,.1,8,20);
    const coolerCapGeometry=new THREE.CylinderGeometry(.98,.82,.28,12);
    const coolerDefinitions=['west-cooler-north','west-cooler-south','east-cooler-north','east-cooler-south'].map(id=>MAP.colliders.find(value=>value.id===id)).filter(Boolean);
    const coolerTransform=(definition,y,rotation)=>({position:[definition.center[0],y,definition.center[2]],rotation});
    energyRelayFallbacks.coolers.push(addInstances(scene,coolerBodyGeometry,graphite,coolerDefinitions.map(value=>coolerTransform(value,1.62))));
    energyRelayFallbacks.coolers.push(addInstances(scene,coolerCapGeometry,panel,coolerDefinitions.map(value=>coolerTransform(value,3.28))));
    const westCoolers=coolerDefinitions.filter(value=>value.id.startsWith('west-')),eastCoolers=coolerDefinitions.filter(value=>value.id.startsWith('east-'));
    const ringTransforms=values=>values.flatMap(value=>[coolerTransform(value,.55,[Math.PI/2,0,0]),coolerTransform(value,2.72,[Math.PI/2,0,0])]);
    energyRelayFallbacks.coolers.push(addInstances(scene,coolerRingGeometry,cyan,ringTransforms(westCoolers)),addInstances(scene,coolerRingGeometry,orange,ringTransforms(eastCoolers)));
    const stripGeometry=new THREE.BoxGeometry(.12,2.05,.03),stripTransforms=values=>values.map(value=>({position:[value.center[0],1.75,value.center[2]+.94]}));
    energyRelayFallbacks.coolers.push(addInstances(scene,stripGeometry,cyan,stripTransforms(westCoolers)),addInstances(scene,stripGeometry,orange,stripTransforms(eastCoolers)));
    coolerDefinitions.forEach(value=>hideCollider(value.id));

    const relay=new THREE.Group();relay.name='NorthRelayTower';relay.position.set(0,1.3,34);
    add(relay,new THREE.CylinderGeometry(1.15,1.3,.55,10),graphite,[0,.28,0]);
    add(relay,new THREE.CylinderGeometry(.34,.46,3.25,10),panel,[0,2.1,0]);
    add(relay,new THREE.TorusGeometry(.82,.1,8,20),cyan,[0,1.15,0],[Math.PI/2,0,0]);
    add(relay,new THREE.TorusGeometry(.82,.1,8,20),cyan,[0,3.55,0],[Math.PI/2,0,0]);
    add(relay,new THREE.CylinderGeometry(.72,.34,.55,10),cyan,[0,3.72,0]);scene.add(relay);energyRelayFallbacks.relay.push(relay);['north-relay-base','north-relay-mast','north-relay-emitter'].forEach(hideCollider);

    const indicatorGeometry=new THREE.BoxGeometry(.07,.42,1.05);
    function cabinetIndicators(ids,material,faceDirection){
      const transforms=[];ids.forEach(id=>{const definition=MAP.colliders.find(value=>value.id===id);if(!definition)return;const [x,y,z]=definition.center,[width,,depth]=definition.size,faceX=x+faceDirection*(width/2+.04);[-1.25,1.25].forEach(offset=>transforms.push({position:[faceX,y,z+Math.max(-depth/3,Math.min(depth/3,offset))]}));});
      energyRelayFallbacks.accents.push(addInstances(scene,indicatorGeometry,material,transforms));
    }
    cabinetIndicators(['west-bay-north','west-bay-south'],cyan,1);cabinetIndicators(['east-bank-north','east-bank-south'],orange,-1);
    energyRelayFallbacks.accents.push(add(scene,new THREE.BoxGeometry(.08,.16,6.5),cyan,[-31.96,1.45,0]));
    energyRelayFallbacks.accents.push(add(scene,new THREE.BoxGeometry(.08,.16,6.5),orange,[31.96,1.45,0]));
    energyRelayFallbacks.accents.push(add(scene,new THREE.BoxGeometry(2.9,.48,.06),orange,[0,2.05,-32.77]));
  }
  createEnergyRelayStationVisuals();
  /**
   * 地图视觉资源和碰撞灰盒使用 colliderRefs 显式关联。只有完整加载成功的 Prefab 才会隐藏灰盒；
   * manifest、GLB 或节点绑定任意一步失败，当前可玩的灰盒地图都会原样保留。
   */
  const mapVisualLoader=THREE.GLTFLoader&&globalThis.MapVisualRuntime?
    MapVisualRuntime.create({THREE,scene,loader:new THREE.GLTFLoader(),grayboxes:obstacleMeshesByColliderId}):null;
  const mapVisualStartedAt=performance.now();
  const mapVisualReady=mapVisualLoader?mapVisualLoader.load('assets/maps/prefabs/manifest.json',MAP.visuals)
    .then(result=>{
      recordAssetTiming('mapVisualMs',mapVisualStartedAt);
      assetTimings.mapPrefabsLoaded=Number(result.loaded)||0;assetTimings.mapPrefabsFailed=Number(result.failed)||0;
      if(result.loaded||result.failed)console.info(`Map prefabs loaded: ${result.loaded}, failed: ${result.failed}`);
      // 只有正式节点成功实例化后才关闭对应程序化版本；资源 404、节点改名或材质失败时仍有完整外观。
      const loadedIds=new Set((result.instances||[]).map(instance=>instance.name)),hide=values=>values.forEach(value=>value.visible=false);
      if(loadedIds.has('energy-core-shell'))hide(energyRelayFallbacks.core);
      if(loadedIds.has('north-relay-shell'))hide(energyRelayFallbacks.relay);
      const coolerIds=['west-cooler-north-shell','west-cooler-south-shell','east-cooler-north-shell','east-cooler-south-shell'];
      if(coolerIds.every(id=>loadedIds.has(id)))hide(energyRelayFallbacks.coolers);
      const detailedIds=['west-bay-north-shell','west-bay-south-shell','east-bank-north-shell','east-bank-south-shell','west-spine-shell','east-spine-shell','south-console-shell'];
      if(detailedIds.every(id=>loadedIds.has(id)))hide(energyRelayFallbacks.accents);
      return result;
    })
    .catch(error=>{assetTimings.mapPrefabsLoaded=0;assetTimings.mapPrefabsFailed=MAP.visuals.length;console.warn('Map prefab manifest failed; keeping grayboxes',error);return {loaded:0,failed:MAP.visuals.length};}):Promise.resolve({loaded:0,failed:0});
  // 边界墙只承担美术表现，实际不可通行区域仍由前后端共享的 49 米地图边界控制。
  const boundaryWall=MAP.environment?.boundaryWall||{height:4.6,thickness:.8,color:'#29343a',roughness:.76,metalness:.12,accentColor:'#72d8df',accentHeight:4.08};
  const wallMaterial=new THREE.MeshStandardMaterial({color:boundaryWall.color,roughness:boundaryWall.roughness,metalness:boundaryWall.metalness});
  function boundaryEdges(){
    if(MAP.bounds.type==='POLYGON')return (MAP.bounds.vertices||[]).map((a,index)=>[a,MAP.bounds.vertices[(index+1)%MAP.bounds.vertices.length]]);
    const [cx,,cz]=MAP.bounds.center,hx=MAP.bounds.size[0]/2,hz=MAP.bounds.size[2]/2;
    return [[[-hx+cx,-hz+cz],[hx+cx,-hz+cz]],[[hx+cx,-hz+cz],[hx+cx,hz+cz]],[[hx+cx,hz+cz],[-hx+cx,hz+cz]],[[-hx+cx,hz+cz],[-hx+cx,-hz+cz]]];
  }
  /** 每条边只计算一次中点、长度和朝向，墙体与灯带共享变换，斜边也不会产生视觉错位。 */
  const boundarySegments=boundaryEdges();
  function concreteWallTexture(){
    const surface=document.createElement('canvas');surface.width=1024;surface.height=256;const context=surface.getContext('2d');
    context.fillStyle='#74797b';context.fillRect(0,0,surface.width,surface.height);
    for(let i=0;i<180;i++){const shade=92+Math.floor(Math.random()*45);context.fillStyle=`rgba(${shade},${shade+2},${shade+3},${.035+Math.random()*.06})`;context.fillRect(Math.random()*1024,Math.random()*256,2+Math.random()*10,1+Math.random()*4);}
    context.strokeStyle='rgba(38,44,46,.48)';context.lineWidth=3;[256,512,768].forEach(x=>{context.beginPath();context.moveTo(x,0);context.lineTo(x,256);context.stroke();});
    context.strokeStyle='rgba(25,30,32,.55)';context.lineWidth=2;[[90,0],[392,256],[710,0]].forEach(([x,y])=>{context.beginPath();context.moveTo(x,y);for(let step=0;step<7;step++){x+=Math.random()*42-15;y+=(y<128?1:-1)*(18+Math.random()*20);context.lineTo(x,y);}context.stroke();});
    const texture=new THREE.CanvasTexture(surface);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());if('colorSpace'in texture)texture.colorSpace=THREE.SRGBColorSpace;return texture;
  }
  const concreteMaterial=new THREE.MeshStandardMaterial({color:0xffffff,map:concreteWallTexture(),roughness:.93,metalness:.02});
  const wallGeometry=new THREE.BoxGeometry(1,1,1),wallDummy=new THREE.Object3D(),concreteIndices=new Set(boundaryWall.concreteSegments||[]);
  const wallTransforms=boundarySegments.map(([a,b],index)=>{const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),angle=-Math.atan2(dz,dx);return {index,length,angle,x:(a[0]+b[0])/2,z:(a[1]+b[1])/2};});
  function addWallBatch(transforms,material,scaleFor){if(!transforms.length)return null;const batch=new THREE.InstancedMesh(wallGeometry,material,transforms.length);transforms.forEach((value,index)=>{wallDummy.position.set(value.x,value.y??boundaryWall.height/2,value.z);wallDummy.rotation.set(0,value.angle,0);wallDummy.scale.fromArray(scaleFor(value));wallDummy.updateMatrix();batch.setMatrixAt(index,wallDummy.matrix);});batch.instanceMatrix.needsUpdate=true;fitInstancedBounds(batch);batch.receiveShadow=true;scene.add(batch);return batch;}
  addWallBatch(wallTransforms.filter(value=>!concreteIndices.has(value.index)),wallMaterial,value=>[value.length,boundaryWall.height,boundaryWall.thickness]);
  const concreteWalls=wallTransforms.filter(value=>concreteIndices.has(value.index));
  addWallBatch(concreteWalls,concreteMaterial,value=>[value.length,boundaryWall.height,boundaryWall.thickness]);
  addWallBatch(wallTransforms.map(value=>({...value,y:boundaryWall.accentHeight})),new THREE.MeshBasicMaterial({color:boundaryWall.accentColor}),value=>[Math.max(.1,value.length-.4),.07,.03]);
  const reinforcement=[];concreteWalls.forEach(value=>{[-.32,0,.32].forEach(t=>reinforcement.push({...value,x:value.x+Math.cos(value.angle)*value.length*t,z:value.z-Math.sin(value.angle)*value.length*t,y:boundaryWall.height/2,beam:'vertical'}));reinforcement.push({...value,y:1.15,beam:'horizontal'});});
  addWallBatch(reinforcement,new THREE.MeshStandardMaterial({color:boundaryWall.reinforcementColor||'#273238',metalness:.7,roughness:.4}),value=>value.beam==='vertical'?[.2,boundaryWall.height-.18,boundaryWall.thickness+.1]:[value.length-.35,.18,boundaryWall.thickness+.1]);
  /**
   * 墙牌内容由地图 JSON 定义，朝向则从多边形边自动计算。默认 Plane 正面沿 +Z，
   * 使用与墙体相同的 angle 后正好指向场内；再沿法线前移，避免贴花与墙面共面闪烁。
   */
  function wallSignAtlas(definitions){
    const surface=document.createElement('canvas'),rows=Math.ceil(definitions.length/2);surface.width=2048;surface.height=rows*256;const context=surface.getContext('2d');
    definitions.forEach((definition,index)=>{const ox=(index%2)*1024,oy=Math.floor(index/2)*256,accent=definition.color;context.save();context.translate(ox,oy);
      context.fillStyle='#0d171d';context.fillRect(0,0,1024,256);context.fillStyle=accent;context.fillRect(0,0,198,256);context.fillRect(198,0,826,13);
      context.fillStyle='#081015';context.font='900 72px Arial, sans-serif';context.textAlign='center';context.textBaseline='middle';context.fillText(definition.code,99,128,170);
      context.textAlign='left';context.fillStyle='#f2f7f7';context.font='800 54px Arial, sans-serif';context.fillText(definition.title,242,100);
      context.fillStyle=accent;context.font='700 25px Arial, sans-serif';context.fillText(definition.subtitle,244,161);
      context.fillStyle='#789099';context.font='600 18px Consolas, monospace';context.fillText('ZERO ARENA // ENERGY TRANSFER FACILITY',244,211);
      for(let x=900;x<1100;x+=42){context.save();context.translate(x,0);context.rotate(.42);context.fillStyle=accent;context.globalAlpha=.3;context.fillRect(0,-80,14,420);context.restore();}context.restore();});
    const texture=new THREE.CanvasTexture(surface);texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());if('colorSpace'in texture)texture.colorSpace=THREE.SRGBColorSpace;return texture;
  }
  const wallSignDefinitions=MAP.environment?.wallSigns||[];
  if(wallSignDefinitions.length){
    const positions=[],uvs=[],indices=[];
    wallSignDefinitions.forEach((definition,index)=>{const segment=boundarySegments[definition.edgeIndex];if(!segment)return;const [a,b]=segment,dx=b[0]-a[0],dz=b[1]-a[1],angle=-Math.atan2(dz,dx),cos=Math.cos(angle),sin=Math.sin(angle),offset=boundaryWall.thickness/2+.025;
      const centerX=(a[0]+b[0])/2+sin*offset,centerZ=(a[1]+b[1])/2+cos*offset,halfWidth=definition.width/2,halfHeight=definition.height/2,base=positions.length/3;
      [[-halfWidth,-halfHeight],[halfWidth,-halfHeight],[halfWidth,halfHeight],[-halfWidth,halfHeight]].forEach(([x,y])=>positions.push(centerX+x*cos,definition.verticalOffset+y,centerZ-x*sin));
      const column=index%2,row=Math.floor(index/2),rows=Math.ceil(wallSignDefinitions.length/2),u0=column*.5,u1=u0+.5,v1=1-row/rows,v0=1-(row+1)/rows;uvs.push(u0,v0,u1,v0,u1,v1,u0,v1);indices.push(base,base+1,base+2,base,base+2,base+3);
    });
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeBoundingSphere();
    const signs=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:wallSignAtlas(wallSignDefinitions),side:THREE.FrontSide}));signs.renderOrder=2;scene.add(signs);
  }
  /**
   * 能源中转站墙体管线使用四个 InstancedMesh 批次表达冷却回路和高压母线。
   * 管线贴在墙体上方，不参与碰撞；每一侧无论跨几段墙都只增加一个管线 Draw Call，
   * 卡箍再共享一个批次，避免参考图的工业密度演变成浏览器性能负担。
   */
  function createBoundaryPipeBatch(edgeIndices,material,heights){
    const geometry=new THREE.CylinderGeometry(.085,.085,1,8),transforms=[];
    edgeIndices.forEach(edgeIndex=>{const [a,b]=boundarySegments[edgeIndex],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),angle=-Math.atan2(dz,dx),inwardX=Math.sin(angle),inwardZ=Math.cos(angle);heights.forEach(height=>transforms.push({a,b,dx,dz,length,inwardX,inwardZ,height}));});
    const batch=new THREE.InstancedMesh(geometry,material,transforms.length),dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0);
    transforms.forEach((value,index)=>{const inset=boundaryWall.thickness/2+.16;dummy.position.set((value.a[0]+value.b[0])/2+value.inwardX*inset,value.height,(value.a[1]+value.b[1])/2+value.inwardZ*inset);dummy.quaternion.setFromUnitVectors(up,new THREE.Vector3(value.dx,0,value.dz).normalize());dummy.scale.set(1,Math.max(1,value.length-2.2),1);dummy.updateMatrix();batch.setMatrixAt(index,dummy.matrix);});
    batch.instanceMatrix.needsUpdate=true;fitInstancedBounds(batch);scene.add(batch);return batch;
  }
  if(MAP.environment?.theme==='energy_relay_station_day'){
    const coldPipe=new THREE.MeshStandardMaterial({color:0x82959c,metalness:.82,roughness:.3}),copperPipe=new THREE.MeshStandardMaterial({color:0x9b6338,metalness:.72,roughness:.34});
    createBoundaryPipeBatch([8,9],coldPipe,[2.62,2.92]);createBoundaryPipeBatch([2,3],copperPipe,[2.62,2.92]);
    const bracketGeometry=new THREE.BoxGeometry(.13,.58,.18),bracketMaterial=new THREE.MeshStandardMaterial({color:0x151d21,metalness:.7,roughness:.38}),brackets=[],dummy=new THREE.Object3D();
    [2,3,8,9].forEach(edgeIndex=>{const [a,b]=boundarySegments[edgeIndex],dx=b[0]-a[0],dz=b[1]-a[1],angle=-Math.atan2(dz,dx),inwardX=Math.sin(angle),inwardZ=Math.cos(angle);[.28,.72].forEach(t=>brackets.push({x:a[0]+dx*t+inwardX*(boundaryWall.thickness/2+.2),z:a[1]+dz*t+inwardZ*(boundaryWall.thickness/2+.2),angle}));});
    const bracketBatch=new THREE.InstancedMesh(bracketGeometry,bracketMaterial,brackets.length);brackets.forEach((value,index)=>{dummy.position.set(value.x,2.77,value.z);dummy.rotation.set(0,value.angle,0);dummy.scale.set(1,1,1);dummy.updateMatrix();bracketBatch.setMatrixAt(index,dummy.matrix);});bracketBatch.instanceMatrix.needsUpdate=true;fitInstancedBounds(bracketBatch);scene.add(bracketBatch);
  }
  // 灯带中心向场内突出 3.5cm，并把厚度压到 3cm。它与墙体内表面之间保留明确深度差，
  // 即使玩家贴墙、斜视或浏览器深度缓冲精度较低，也不会出现共面 Z-fighting 闪烁。
  // 灯位来自地图配置：前三盏覆盖核心、北训练区和南维护区，低画质也保留基本可读性。
  const arenaLights=(MAP.environment?.lights||[]).map((definition,index)=>{const light=new THREE.PointLight(definition.color,definition.intensity,definition.distance,2);light.position.fromArray(definition.position);light.name=definition.id;light.visible=index<quality.lights;scene.add(light);return light;});
  stars.visible=!!atmosphere.stars&&quality.stars;
  /** 画质只影响客户端表现预算，不改变碰撞、射击和网络同步。切换后立即生效并持久化。 */
  function applyQuality(next){if(!QUALITY[next])return;qualityName=next;quality=QUALITY[next];localStorage.setItem('neonArenaQuality',next);renderer.setPixelRatio(Math.min(devicePixelRatio,quality.pixelRatio));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=quality.shadows;moonLight.castShadow=quality.shadows;arenaLights.forEach((light,index)=>light.visible=index<quality.lights);pickupLights.forEach(light=>light.visible=quality.pickupLights);stars.visible=!!atmosphere.stars&&quality.stars;document.querySelectorAll('#qualityControl button').forEach(button=>button.classList.toggle('active',button.dataset.quality===next));}
  const pickupLights=[];function pickupLight(color,intensity,distance){const light=new THREE.PointLight(color,intensity,distance);light.visible=quality.pickupLights;pickupLights.push(light);return light;}
  const pickupCrateGeometry={body:new THREE.BoxGeometry(1.18,.42,.62),lid:new THREE.BoxGeometry(1.12,.11,.58),rail:new THREE.BoxGeometry(.08,.13,.64),latch:new THREE.BoxGeometry(.13,.13,.035),markBody:new THREE.BoxGeometry(.48,.07,.025),markBarrel:new THREE.BoxGeometry(.34,.035,.025),markStock:new THREE.BoxGeometry(.16,.14,.025),markMag:new THREE.BoxGeometry(.11,.15,.025)};
  const pickupCrateBodyMaterial=new THREE.MeshStandardMaterial({color:0x17232b,metalness:.62,roughness:.38});
  const SUPPLY_META={MEDKIT_SMALL:{name:'小型医疗包',color:0x49d985},ARMOR_VEST:{name:'防弹衣',color:0x5da9ff},SPEED_BOOST:{name:'动力增幅',color:0xffcc55},STEALTH_FIELD:{name:'光学隐身',color:0xb56cff},AMMO_BOX:{name:'弹药箱',color:0xf2c94c},THROWABLE_FRAG:{name:'破片手雷补给',color:0xff7d45},THROWABLE_FLASH:{name:'闪光弹补给',color:0xe9f4ff},THROWABLE_SMOKE:{name:'烟雾弹补给',color:0x78b889}};
  /**
   * 地图只展示统一轻量补给箱，不复用带手臂/骨骼的 ViewModel。所有箱体共享几何与
   * 主材质，单个实例只创建一份强调材质，后续替换正式 GLB 时仍保留相同 itemId 契约。
   */
  function createPickupCrate(itemId,accent,fallbackPosition){
    const group=new THREE.Group(),accentMaterial=new THREE.MeshStandardMaterial({color:accent,emissive:accent,emissiveIntensity:1.15,metalness:.32,roughness:.3});
    const body=new THREE.Mesh(pickupCrateGeometry.body,pickupCrateBodyMaterial),lid=new THREE.Mesh(pickupCrateGeometry.lid,pickupCrateBodyMaterial),leftRail=new THREE.Mesh(pickupCrateGeometry.rail,accentMaterial),rightRail=leftRail.clone(),leftLatch=new THREE.Mesh(pickupCrateGeometry.latch,accentMaterial),rightLatch=leftLatch.clone();
    lid.position.y=.265;leftRail.position.x=-.43;rightRail.position.x=.43;leftLatch.position.set(-.28,.08,.329);rightLatch.position.set(.28,.08,.329);group.add(body,lid,leftRail,rightRail,leftLatch,rightLatch);
    // 正面发光枪械剪影是武器箱的稳定识别符；医疗箱未来使用独立短箱与十字标识。
    const mark=new THREE.Group(),markBody=new THREE.Mesh(pickupCrateGeometry.markBody,accentMaterial),markBarrel=new THREE.Mesh(pickupCrateGeometry.markBarrel,accentMaterial),markStock=new THREE.Mesh(pickupCrateGeometry.markStock,accentMaterial),markMag=new THREE.Mesh(pickupCrateGeometry.markMag,accentMaterial);markBody.position.x=.02;markBarrel.position.x=.42;markStock.position.set(-.31,-.035,0);markStock.rotation.z=-.35;markMag.position.set(.04,-.1,0);markMag.rotation.z=-.18;mark.add(markBody,markBarrel,markStock,markMag);mark.position.set(0,.1,.337);group.add(mark);
    group.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=false;}});
    const definition=MAP.pickups.find(item=>item.id===itemId),position=definition?.position||fallbackPosition;
    // pickup.position.y 表示箱子所在表面的高度。记录每个箱子的独立基准，避免高台箱在
    // 悬浮动画中被错误重置到地面箱的固定高度，出现箱体沉入平台的现象。
    group.userData.hoverBaseY=(position[1]||0)+1.1;group.position.set(position[0],group.userData.hoverBaseY,position[2]);scene.add(group);return group;
  }
  const supplyGeometry={vest:new THREE.BoxGeometry(.62,.72,.22),shoulder:new THREE.BoxGeometry(.86,.2,.28),medkit:new THREE.BoxGeometry(.72,.42,.5),crossV:new THREE.BoxGeometry(.12,.3,.04),crossH:new THREE.BoxGeometry(.34,.12,.04),boost:new THREE.CylinderGeometry(.28,.34,.72,8),boostCore:new THREE.CylinderGeometry(.14,.18,.76,8),ammo:new THREE.BoxGeometry(.68,.38,.5),ammoCell:new THREE.BoxGeometry(.12,.24,.08),throwable:new THREE.CylinderGeometry(.18,.23,.55,8),band:new THREE.TorusGeometry(.23,.045,5,12)},supplyDarkMaterial=new THREE.MeshLambertMaterial({color:0x182329}),supplyAccentMaterials=new Map();
  function supplyAccentMaterial(color){if(!supplyAccentMaterials.has(color))supplyAccentMaterials.set(color,new THREE.MeshBasicMaterial({color}));return supplyAccentMaterials.get(color);}
  function createSupplyPickup(definition){
    const meta=SUPPLY_META[definition.itemType]||{name:'补给',color:0x65dce6},group=new THREE.Group(),material=supplyAccentMaterial(meta.color),dark=supplyDarkMaterial;
    let body;
    if(definition.itemType==='ARMOR_VEST'){
      body=new THREE.Mesh(supplyGeometry.vest,material);const shoulder=new THREE.Mesh(supplyGeometry.shoulder,dark);shoulder.position.y=.25;group.add(body,shoulder);
    }else if(definition.itemType==='MEDKIT_SMALL'){
      body=new THREE.Mesh(supplyGeometry.medkit,dark);const vertical=new THREE.Mesh(supplyGeometry.crossV,material),horizontal=new THREE.Mesh(supplyGeometry.crossH,material);vertical.position.z=.27;horizontal.position.z=.27;group.add(body,vertical,horizontal);
    }else if(definition.itemType==='SPEED_BOOST'){
      body=new THREE.Mesh(supplyGeometry.boost,dark);const core=new THREE.Mesh(supplyGeometry.boostCore,material);group.add(body,core);
    }else if(definition.itemType==='STEALTH_FIELD'){
      body=new THREE.Mesh(new THREE.IcosahedronGeometry(.34,1),material);const halo=new THREE.Mesh(new THREE.TorusGeometry(.48,.045,5,16),dark);halo.rotation.x=Math.PI/2;group.add(body,halo);
    }else if(definition.itemType==='AMMO_BOX'){
      body=new THREE.Mesh(supplyGeometry.ammo,dark);for(const x of[-.2,0,.2]){const cell=new THREE.Mesh(supplyGeometry.ammoCell,material);cell.position.set(x,.02,.29);group.add(cell);}const stripe=new THREE.Mesh(supplyGeometry.crossH,material);stripe.scale.x=1.45;stripe.position.z=.28;group.add(body,stripe);
    }else{
      body=new THREE.Mesh(supplyGeometry.throwable,material);body.rotation.z=Math.PI/2;const band=new THREE.Mesh(supplyGeometry.band,dark);band.rotation.y=Math.PI/2;group.add(body,band);
    }
    group.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=false;}});group.userData.hoverBaseY=(definition.position?.[1]||0)+1;group.userData.itemName=meta.name;group.position.set(definition.position[0],group.userData.hoverBaseY,definition.position[2]);scene.add(group);return group;
  }
  const pickupDefinitionsById=new Map((MAP.pickups||[]).map(definition=>[definition.id,definition]));
  const pickupMeshes={};for(const definition of MAP.pickups||[]){pickupMeshes[definition.id]=definition.itemType&&definition.itemType!=='WEAPON'?createSupplyPickup(definition):createPickupCrate(definition.id,{sniper:0x8a79ff,ak47:0xff7138,glock:0x43dec0}[definition.weaponId]||0x65dce6,definition.position);}

  // 程序化第一人称枪械是 GLB 接入前的占位 ViewModel；动作状态不依赖具体模型。
  const weaponViewRoot=new THREE.Group();viewModelCamera.add(weaponViewRoot);const weaponViews={},weaponAssets={},worldWeaponTemplates={},viewAssetLoads=new Set(),worldAssetLoads=new Set();let weaponMuzzleProfiles={},weaponManifest={muzzleProfiles:{},weapons:{}};
  const weaponAssetLoader=THREE.GLTFLoader?new THREE.GLTFLoader():null;
  function buildWeaponView(id){
    if(weaponViews[id])return weaponViews[id];
    const definition=WEAPONS[id]||{},group=new THREE.Group(),fallback=new THREE.Group(),isSniper=definition.category==='SNIPER_RIFLE';group.add(fallback);
    const color=definition.fallbackColor??(isSniper?0x6e58ff:0x35d9ff),dark=0x111827;
    const receiver=new THREE.Mesh(new THREE.BoxGeometry(isSniper?.18:.22,.18,isSniper?1.05:.75),new THREE.MeshStandardMaterial({color:dark,metalness:.75,roughness:.28}));fallback.add(receiver);
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,isSniper?1.25:.75,10),new THREE.MeshStandardMaterial({color,metalness:.8,emissive:color,emissiveIntensity:.12}));barrel.rotation.x=Math.PI/2;barrel.position.z=isSniper?-.95:-.65;fallback.add(barrel);
    const mag=new THREE.Mesh(new THREE.BoxGeometry(.16,.42,.25),new THREE.MeshStandardMaterial({color:0x263449,metalness:.4}));mag.position.set(0,-.28,.08);mag.rotation.x=-.2;fallback.add(mag);
    const bolt=new THREE.Mesh(new THREE.BoxGeometry(.08,.07,.28),new THREE.MeshStandardMaterial({color:0xbdd8e8,metalness:.9}));bolt.position.set(.13,.12,.05);bolt.visible=isSniper;fallback.add(bolt);
    const muzzleEffect=WeaponPreviewRuntime.createMuzzleEffect({THREE,scene:viewModelScene,isSniper,quality:()=>qualityName}),flash=muzzleEffect.root;flash.position.z=isSniper?-1.62:-1.05;group.add(flash);
    group.traverse(object=>{if(object.isMesh){object.material.depthTest=true;object.material.depthWrite=true;}});
    const muzzleLight=muzzleEffect.light;muzzleLight.position.copy(flash.position);group.add(muzzleLight);
    const basePosition=new THREE.Vector3(.42,-.35,-.85);
    group.userData={fallback,mag,bolt,flash,muzzleLight,muzzleEffect,baseMagY:mag.position.y,basePosition,baseRotation:new THREE.Vector3(),mixer:null,clips:new Map(),asset:null};group.position.copy(basePosition);weaponViewRoot.add(group);weaponViews[id]=group;return group;
  }
  Object.keys(WEAPONS).forEach(buildWeaponView);

  /**
   * GLB 是纯表现资源：只有完整加载并完成节点绑定后才隐藏程序化占位模型。
   * 网络失败、模型损坏或节点缺失都不会影响武器状态机和玩家进入房间。
   */
  async function loadWeaponAssets(){
    if(!weaponAssetLoader)return;
    try{
      const [manifestResponse,skinResponse]=await Promise.all([fetch('assets/weapons/manifest.json',{cache:'no-cache'}),fetch('assets/weapons/skins/catalog.json',{cache:'no-cache'})]);if(!manifestResponse.ok)return;
      const manifest=await manifestResponse.json();weaponManifest=manifest;
      if(skinResponse.ok)weaponSkinCatalog=await skinResponse.json();
      if((manifest.contractVersion||0)<1||(manifest.contractVersion||0)>4)console.warn('Unknown weapon asset contract',manifest.contractVersion);
      weaponMuzzleProfiles=manifest.muzzleProfiles||{};
      const contracts=Object.entries(manifest.weapons||{});contracts.forEach(([weaponId,assetContract])=>weaponAssets[weaponId]=assetContract);
      await Promise.all(contracts.map(([weaponId])=>loadWeaponContract(weaponId)));
    }catch(error){console.warn('Weapon manifest failed; using procedural models',error);}
  }

  /**
   * GLTFLoader 的回调接口包装成“永不阻断进入游戏”的 Promise。美术资源失败时保留
   * 程序化占位模型并返回 false；进场准备流程仍能结束，不会出现永久 99% 的加载页。
   */
  function loadWeaponGltf(url,install,onFailure){
    return new Promise(resolve=>weaponAssetLoader.load(url,gltf=>{
      try{install(gltf);resolve(true);}catch(error){onFailure(error);resolve(false);}
    },undefined,error=>{onFailure(error);resolve(false);}));
  }

  /** 同一资源只发起一次加载；服务端目录和 manifest 无论谁先到都能最终汇合。 */
  async function loadWeaponContract(weaponId){
    const assetContract=weaponAssets[weaponId];if(!assetContract||!weaponAssetLoader)return [];
    const jobs=[];
    const viewBase=assetContract.viewModel||assetContract;
    if(viewBase.enabled!==false&&viewBase.url&&weaponViews[weaponId]&&!viewAssetLoads.has(weaponId)){
      viewAssetLoads.add(weaponId);let config=viewBase;
      if(viewBase.layoutUrl){try{const layoutResponse=await fetch(viewBase.layoutUrl,{cache:'no-cache'});if(!layoutResponse.ok)throw new Error(`HTTP ${layoutResponse.status}`);const loadedLayout=await layoutResponse.json();config=WeaponLayoutRuntime.merge(viewBase,loadedLayout);if(loadedLayout.audio)assetContract.audio={...(assetContract.audio||{}),...loadedLayout.audio};}catch(error){console.warn(`Weapon layout ${weaponId} failed; using manifest defaults`,error);}}
      config.effects=WeaponLayoutRuntime.resolveEffects({muzzleProfiles:weaponMuzzleProfiles},config);
      jobs.push(loadWeaponGltf(config.url,gltf=>installWeaponAsset(weaponId,config,gltf),error=>{viewAssetLoads.delete(weaponId);console.warn(`Weapon ViewModel ${weaponId} failed; using fallback`,error);}));
    }
    const world=assetContract.worldModel;
    if(world?.url&&!worldAssetLoads.has(weaponId)){worldAssetLoads.add(weaponId);jobs.push(loadWeaponGltf(world.url,gltf=>installWorldWeaponAsset(weaponId,world,gltf),error=>{worldAssetLoads.delete(weaponId);console.warn(`Weapon WorldModel ${weaponId} failed; using fallback`,error);}));}
    return Promise.all(jobs);
  }

  /**
   * WorldModel 是其他玩家和地图掉落看到的轻量模型，不包含第一人称手臂。
   * 模板只加载一次；每个远端玩家使用 clone，避免多人房间重复下载同一 GLB。
   */
  function installWorldWeaponAsset(weaponId,config,gltf){
    const template=gltf.scene;template.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
    worldWeaponTemplates[weaponId]={template,config};
    remote.forEach(object=>{if(object.userData.weaponId===weaponId)syncRemoteWeapon(object,weaponId,object.userData.skinId,true);});
  }
  /**
   * 某些带蒙皮动画的第三方 GLB 不适合经过 Blender 二次导出，否则可能破坏权重。
   * 对这类资源，manifest 使用原模型坐标描述挂点，客户端再把挂点挂到武器 Root 骨骼下。
   */
  function createVirtualAttachment(asset,parentName,position,name){
    if(!position)return null;asset.updateMatrixWorld(true);
    const parent=asset.getObjectByName(parentName)||asset,world=asset.localToWorld(new THREE.Vector3().fromArray(position));
    const marker=new THREE.Object3D();marker.name=name;parent.add(marker);parent.updateMatrixWorld(true);marker.position.copy(parent.worldToLocal(world));return marker;
  }
  function installWeaponAsset(weaponId,config,gltf){
    const view=weaponViews[weaponId],asset=gltf.scene;asset.name=`${weaponId}-asset`;asset.scale.setScalar(config.scale||1);asset.position.fromArray(config.position||[0,0,0]);asset.rotation.fromArray(config.axisRotation||config.rotation||[0,0,0]);
    const materialColors=config.materialColors||{};
    asset.traverse(object=>{if(object.isMesh){const materials=Array.isArray(object.material)?object.material:[object.material];object.material=materials.map(material=>{const copy=material.clone();copy.depthTest=true;copy.depthWrite=true;if(copy.color){if(materialColors[material.name]!=null)copy.color.set(materialColors[material.name]);else copy.color.offsetHSL(0,0,.07);}if(copy.emissive&&copy.color){copy.emissive.copy(copy.color);copy.emissiveIntensity=.18;}return copy;});if(object.material.length===1)object.material=object.material[0];}});view.add(asset);view.userData.asset=asset;view.userData.assetConfig=config;view.userData.mixer=new THREE.AnimationMixer(asset);gltf.animations.forEach(clip=>view.userData.clips.set(clip.name.toLowerCase(),clip));
    // 外部资源的动画命名不统一。manifest 将语义名映射到原片段名，后续状态机只认 idle/fire/reload 等稳定名称。
    Object.entries(config.animations||{}).forEach(([semantic,sourceName])=>{
      const clip=gltf.animations.find(value=>value.name.toLowerCase()===String(sourceName).toLowerCase());if(!clip)return;
      const includes=config.animationTrackIncludes?.[semantic];
      // 分层动作只保留指定节点轨道。例如手枪 Shoot 只驱动套筒、扳机和枪管，
      // Idle 继续控制双臂，避免第三方整段动作把持枪姿态瞬间拉出画面。
      const mapped=includes?.length?new THREE.AnimationClip(semantic,clip.duration,clip.tracks.filter(track=>includes.some(name=>track.name.includes(name)))):clip;
      view.userData.clips.set(semantic.toLowerCase(),mapped);
    });
    // A third-party rig can contain one damaged semantic clip while its geometry
    // remains usable. Removing only those aliases lets the existing procedural
    // fallback handle that state without rejecting the complete GLB asset.
    (config.disabledAnimations||[]).forEach(name=>view.userData.clips.delete(String(name).toLowerCase()));
    // Keep project-owned rigid arms on a separate, non-animated correction root.
    // The imported AK arms extend through the view camera; putting the offset on
    // CommonArmsRoot itself would be overwritten by AnimationMixer every frame.
    if(config.armRoot&&config.armOffset){
      const armRoot=asset.getObjectByName(config.armRoot);
      if(armRoot&&armRoot.parent){
        const wrapper=new THREE.Group();wrapper.name=`${config.armRoot}ViewOffset`;
        armRoot.parent.add(wrapper);wrapper.add(armRoot);wrapper.position.fromArray(config.armOffset);
        if(config.armRotation)wrapper.rotation.fromArray(config.armRotation);
        view.userData.armWrapper=wrapper;
      }
    }
    // Per-weapon grip corrections stay in manifest.json. Wrapping the target node
    // preserves the offset even when AnimationMixer writes the node's own transform.
    Object.entries(config.nodeOffsets||{}).forEach(([nodeName,offset])=>{
      const node=asset.getObjectByName(nodeName);if(!node||!node.parent||!Array.isArray(offset))return;
      const wrapper=new THREE.Group();wrapper.name=`${nodeName}ViewOffset`;
      node.parent.add(wrapper);wrapper.add(node);wrapper.position.fromArray(offset);
    });
    // Layout positions are the shared source of truth used by Blender generation
    // and the browser tuner. Fire does not animate these pivots, so assigning the
    // same local values here keeps authored and runtime coordinates identical.
    // 屏幕持握位置属于资源配置；向 0 调整 Z，会让枪托更靠近肩部/镜头。
    if(config.viewPosition)view.userData.basePosition.fromArray(config.viewPosition);
    if(config.viewRotation)view.userData.baseRotation.fromArray(config.viewRotation);
    const nodes=config.nodes||{},mag=nodes.magazine&&asset.getObjectByName(nodes.magazine),bolt=nodes.bolt&&asset.getObjectByName(nodes.bolt);
    // Prefer a ViewModel-space override because it remains stable after GLB re-export.
    let ejectionPort=nodes.ejectionPort&&asset.getObjectByName(nodes.ejectionPort);
    if(!ejectionPort)ejectionPort=createVirtualAttachment(asset,nodes.weaponRoot,config.ejectionPosition,'RuntimeEjectionPort');
    if(mag){view.userData.mag=mag;view.userData.baseMagY=mag.position.y;}if(bolt)view.userData.bolt=bolt;
    view.userData.ejectionPort=ejectionPort||null;
    applyViewModelLayout(view,asset,config);
    applyViewSkin(weaponId,equippedSkins[weaponId]);
    view.userData.fallback.visible=false;
    playAssetIdle(view);
  }
  /**
   * 第一人称模型唯一的布局入口。冷加载和热更新调用完全相同的绑定流程，保证保存、
   * 刷新与重新进入游戏后不会因为走了不同分支而改变枪口位置。
   */
  function applyViewModelLayout(view,asset,config){
    view.userData.assetConfig=config;view.userData.baseAssetConfig=config;
    WeaponLayoutRuntime.applyLayout({asset,view,armWrapper:view.userData.armWrapper,config});
    const resolved=WeaponLayoutRuntime.resolveMuzzle({THREE,asset,config,existingAttachment:view.userData.muzzle});
    view.userData.muzzle=resolved.attachment;view.userData.muzzleBinding=resolved.binding;
    if(resolved.binding.mode==='NODE')syncMuzzleAttachment(view);
    else{view.userData.flash.position.fromArray(resolved.binding.position);view.userData.flash.rotation.fromArray(resolved.binding.rotation);}
    syncMuzzleOrientation(view);view.userData.muzzleLight.position.copy(view.userData.flash.position);
  }

  /**
   * 皮肤只组合材质和枪口视觉参数；模型坐标、动作与战斗数值继续使用基础武器配置。
   * resolve 会对未知或跨武器 skinId 回退，applyMaterials 会克隆命中材质，避免污染共享模板。
   */
  function resolveSkin(weaponId,skinId){const contract=weaponAssets[weaponId];if(!contract||!globalThis.WeaponSkinRuntime)return null;return WeaponSkinRuntime.resolve(weaponSkinCatalog,weaponManifest,contract,skinId);}
  function applyViewSkin(weaponId,skinId){const view=weaponViews[weaponId],asset=view?.userData.asset,resolved=resolveSkin(weaponId,skinId);if(!view||!asset||!resolved)return;WeaponSkinRuntime.applyMaterials(asset,resolved);const visualConfig=WeaponSkinRuntime.composeViewConfig(view.userData.baseAssetConfig||view.userData.assetConfig,resolved);view.userData.skinEffects=WeaponLayoutRuntime.resolveEffects(weaponManifest,visualConfig);view.userData.skinId=resolved.skinId;}

  /** Apply a developer-studio layout without replacing the loaded GLB. */
  function applyWeaponLayoutLive(weaponId,layout){
    if(layout.audio&&weaponAssets[weaponId])weaponAssets[weaponId].audio={...(weaponAssets[weaponId].audio||{}),...layout.audio};
    const view=weaponViews[weaponId],asset=view?.userData.asset;if(!view||!asset)return;
    applyViewModelLayout(view,asset,WeaponLayoutRuntime.merge(view.userData.baseAssetConfig||view.userData.assetConfig,layout));applyViewSkin(weaponId,equippedSkins[weaponId]);
  }
  function applyDeveloperMessage(message){if(message?.type==='weapon-layout'&&message.weaponId&&message.layout)applyWeaponLayoutLive(message.weaponId,message.layout);else if(message?.type==='throwable-layout'&&message.layout)applyGrenadeLayoutLive(message.layout);else if(message?.type==='build-started')chat('开发版本正在构建，服务稍后会自动重连。',true);else if(message?.type==='build-complete')chat(`服务已升级到 ${message.build?.version||'新版本'}。`,true);}
  if('BroadcastChannel'in window){globalThis.__ZERO_DEV_CHANNEL__=new BroadcastChannel('neon-weapon-dev');globalThis.__ZERO_DEV_CHANNEL__.onmessage=event=>applyDeveloperMessage(event.data);}
  addEventListener('storage',event=>{if(event.key!=='zeroWeaponDevMessage'||!event.newValue)return;try{applyDeveloperMessage(JSON.parse(event.newValue).message);}catch(error){console.warn('Invalid developer layout message',error);}});
  /**
   * Muzzle 位于动画 GLB 内部，而枪口火焰仍是独立的高亮 Three.js 几何体。
   * 每帧把节点的世界变换转换回 ViewModel 局部空间，确保射击/换弹时特效始终粘在枪管上。
   */
  function syncMuzzleAttachment(view){
    const muzzle=view.userData.muzzle;if(!muzzle)return;
    view.updateMatrixWorld(true);muzzle.updateMatrixWorld(true);
    const worldPosition=new THREE.Vector3();muzzle.getWorldPosition(worldPosition);
    view.userData.flash.position.copy(view.worldToLocal(worldPosition));
    syncMuzzleOrientation(view);
    // 火焰几何按屏幕空间制作成星芒，不继承枪模坐标轴；继承旋转会让星芒整体偏向枪口下方。
    view.userData.muzzleLight.position.copy(view.userData.flash.position);
  }
  // Flash geometry is authored along local -Z. Convert each weapon's barrel
  // direction into ViewModel space so the flame projects out of the muzzle,
  // rather than back toward the camera when a GLB uses a different axis.
  function syncMuzzleOrientation(view){
    const binding=view.userData.muzzleBinding;
    if(binding?.mode==='NODE'){view.userData.flash.rotation.fromArray(binding.rotationOffset||[0,0,0]);return;}
    if(binding?.mode==='VIEW'){view.userData.flash.rotation.fromArray(binding.rotation||[0,0,0]);return;}
    const direction=view.userData.assetConfig?.muzzleDirection;if(!Array.isArray(direction))return;
    const asset=view.userData.asset;if(!asset)return;
    asset.updateMatrixWorld(true);view.updateMatrixWorld(true);
    const origin=asset.localToWorld(new THREE.Vector3(0,0,0));
    const tip=asset.localToWorld(new THREE.Vector3().fromArray(direction));
    const localOrigin=view.worldToLocal(origin.clone()),localTip=view.worldToLocal(tip.clone());
    const barrelDirection=localTip.sub(localOrigin).normalize();
    view.userData.flash.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),barrelDirection);
  }
  /** READY 状态持续循环待机；其他一次性动作结束后也统一回到这里。 */
  function playAssetIdle(view){
    const mixer=view.userData.mixer,pose=view.userData.assetConfig?.idlePose;
    const clip=view.userData.clips.get(String(pose?.clip||'idle').toLowerCase());if(!mixer||!clip||view.userData.firePlaying)return;
    const action=view.userData.idleAction||mixer.clipAction(clip);view.userData.idleAction=action;
    if(pose){
      // Freeze a known-good authored frame when Blender has corrupted the rig's
      // nominal Idle root rotation. Procedural bob/recoil still runs on the outer
      // weapon group, so a paused asset pose does not make the weapon feel static.
      if(!view.userData.idlePoseApplied){
        action.enabled=true;action.paused=false;action.reset().play();
        action.time=clip.duration*Math.max(0,Math.min(1,pose.normalizedTime??0));
        // Apply the sampled transforms while the action is active. Pausing before
        // this update leaves unskinned child nodes such as CommonArmsRoot at bind pose.
        mixer.update(0);action.paused=true;view.userData.idlePoseApplied=true;
      }
    }else if(!action.isRunning()){action.reset();action.setLoop(THREE.LoopRepeat,Infinity);action.play();}
  }
  /**
   * 服务端给出动作起止时间，客户端不自行猜测换弹进度。动画被暂停后按 progress
   * 采样，因此网络帧率变化也不会让换弹时长漂移；回到 READY 后恢复 Idle。
   */
  function syncAssetAction(view,state,progress){
    const mixer=view.userData.mixer;if(!mixer)return;
    const clipName={RELOADING:'reload',EQUIPPING:'equip',CYCLING:'cycle'}[state];
    if(!clipName){
      if(view.userData.assetAction){view.userData.assetAction.stop();view.userData.assetAction=null;view.userData.assetActionName=null;}
      if(!view.userData.firePlaying)playAssetIdle(view);return;
    }
    const clip=view.userData.clips.get(clipName);if(!clip)return;
    if(view.userData.assetActionName!==clipName){
      mixer.stopAllAction();view.userData.firePlaying=false;
      view.userData.assetAction=mixer.clipAction(clip);view.userData.assetAction.reset().play();view.userData.assetAction.paused=true;view.userData.assetActionName=clipName;
    }
    view.userData.assetAction.time=clip.duration*progress;mixer.update(0);
  }
  /** 自动射击会反复重置 Fire clip；最后一发结束时再平滑回到 Idle。 */
  function playAssetFire(view){
    // Some imported root animations take the long quaternion arc and rotate the
    // complete rifle by 180 degrees. The outer view-model already supplies recoil,
    // so these assets can opt out of only the broken inner Fire clip.
    if(view.userData.assetConfig?.proceduralFire)return;
    const mixer=view.userData.mixer,clip=view.userData.clips.get('fire');if(!mixer||!clip)return;
    if(!view.userData.assetConfig?.layeredFire)mixer.stopAllAction();const action=mixer.clipAction(clip);view.userData.firePlaying=true;
    action.reset();action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=false;action.play();
    const onFinished=event=>{if(event.action!==action)return;mixer.removeEventListener('finished',onFinished);view.userData.firePlaying=false;action.stop();playAssetIdle(view);};
    mixer.addEventListener('finished',onFinished);
  }
  const weaponAssetsStartedAt=performance.now();
  const weaponAssetsReady=loadWeaponAssets().then(result=>{recordAssetTiming('weaponAssetsMs',weaponAssetsStartedAt);return result;});

  const visualParticles=[],visualTracers=[];
  const grenadeVisualStates=new Map();
  const smokeVisualStates=new Map();
  function createSmokeTexture(){
    const size=128,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const context=canvas.getContext('2d'),image=context.createImageData(size,size);
    // Deterministic value noise has no preferred horizontal/vertical direction. The old
    // sine-wave texture produced visible bands whenever several billboards overlapped.
    const hash=(x,y,seed)=>{let value=Math.imul(x+seed*1013,374761393)^Math.imul(y-seed*733,668265263);value=Math.imul(value^(value>>>13),1274126177);return ((value^(value>>>16))>>>0)/4294967295;};
    const valueNoise=(x,y,cell,seed)=>{const gx=Math.floor(x/cell),gy=Math.floor(y/cell),fx=x/cell-gx,fy=y/cell-gy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),a=hash(gx,gy,seed),b=hash(gx+1,gy,seed),c=hash(gx,gy+1,seed),d=hash(gx+1,gy+1,seed);return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a,b,sx),THREE.MathUtils.lerp(c,d,sx),sy);};
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const nx=(x+.5-size/2)/(size/2),ny=(y+.5-size/2)/(size/2),radius=Math.hypot(nx,ny),broad=valueNoise(x,y,32,17),medium=valueNoise(x,y,16,43),fine=valueNoise(x,y,8,89),noise=broad*.52+medium*.31+fine*.17,irregularEdge=.78+(broad-.5)*.2+(medium-.5)*.08,edge=1-THREE.MathUtils.smoothstep(radius,irregularEdge,1.08),density=THREE.MathUtils.clamp(.68+noise*.42,0,1),offset=(y*size+x)*4;image.data[offset]=226;image.data[offset+1]=231;image.data[offset+2]=229;image.data[offset+3]=Math.round(255*edge*density);}context.putImageData(image,0,0);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;return texture;
  }
  const MAX_SMOKE_PLANES=168,smokeDummy=new THREE.Object3D(),smokeBatch=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:createSmokeTexture(),color:0x687170,transparent:true,opacity:.94,alphaTest:.018,depthWrite:false,side:THREE.DoubleSide}),MAX_SMOKE_PLANES);smokeBatch.count=0;smokeBatch.frustumCulled=false;smokeBatch.renderOrder=3;scene.add(smokeBatch);
  /**
   * 第一人称投掷物是独立轻量 ViewModel，不依赖某一把枪的骨骼。服务端动作进入
   * THROWING_GRENADE 时才显示，commit 后只隐藏弹体并让双臂完成随动，避免手雷复制。
   */
  function createGrenadeThrowView(){
    const root=new THREE.Group(),fallback=new THREE.Group(),olive=new THREE.MeshStandardMaterial({color:0x58684e,emissive:0x152012,emissiveIntensity:.22,metalness:.45,roughness:.48}),metal=new THREE.MeshStandardMaterial({color:0xaab1aa,metalness:.86,roughness:.24}),skin=new THREE.MeshStandardMaterial({color:0xc89472,roughness:.72}),sleeve=new THREE.MeshStandardMaterial({color:0x315c78,roughness:.62});
    const grenade=new THREE.Group(),body=new THREE.Mesh(new THREE.IcosahedronGeometry(.105,1),olive),neck=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,.08,8),metal),lever=new THREE.Mesh(new THREE.BoxGeometry(.045,.025,.17),metal),ring=new THREE.Mesh(new THREE.TorusGeometry(.047,.008,6,14),metal);
    body.scale.set(.82,1.18,.82);neck.position.y=.13;lever.position.set(.03,.17,.03);lever.rotation.x=-.16;ring.position.set(-.075,.155,0);ring.rotation.y=Math.PI/2;grenade.add(body,neck,lever,ring);grenade.position.set(.035,.09,.055);
    const armGeometry=new THREE.CylinderGeometry(.068,.105,.42,8),handGeometry=new THREE.SphereGeometry(.095,8,6);
    const rightArm=new THREE.Group(),rightSleeve=new THREE.Mesh(armGeometry,sleeve),rightHand=new THREE.Mesh(handGeometry,skin),rightThumb=new THREE.Mesh(new THREE.CylinderGeometry(.025,.032,.13,7),skin);rightSleeve.position.set(.13,-.25,.1);rightSleeve.rotation.z=-.34;rightHand.position.set(.045,-.085,.065);rightHand.scale.set(.78,1,.68);rightThumb.position.set(-.1,.015,-.02);rightThumb.rotation.set(.7,0,.8);rightHand.add(rightThumb);rightArm.add(rightSleeve,rightHand);
    const leftArm=new THREE.Group(),leftSleeve=new THREE.Mesh(armGeometry,sleeve),leftHand=new THREE.Mesh(handGeometry,skin),leftThumb=new THREE.Mesh(new THREE.CylinderGeometry(.025,.032,.12,7),skin);leftSleeve.position.set(-.11,-.24,.11);leftSleeve.rotation.z=.38;leftHand.position.set(.015,-.025,.05);leftHand.scale.set(.76,.94,.66);leftThumb.position.set(.1,.02,.015);leftThumb.rotation.set(.5,0,-.75);leftHand.add(leftThumb);leftArm.add(leftSleeve,leftHand);
    fallback.add(grenade,rightArm,leftArm);root.add(fallback);root.visible=false;root.position.set(.16,-.2,-.9);root.userData={fallback,grenade,ring,rightArm,leftArm,asset:null};viewModelCamera.add(root);return root;
  }
  const grenadeThrowView=createGrenadeThrowView();
  let grenadeViewLayout={scale:.08,axisRotation:[-2.898244,1.420444,3.070327],viewPosition:[.22,-.38,-.45],viewRotation:[-.02137,.007353,.069742],armOffset:[3.827532,.039686,-.040475],armRotation:[0,0,0],modelPosition:[.26,-.25,.02],modelRotation:[-.18,.08,-.18],modelScale:1.2,pinPullOffset:[0,.22,-.65]},remoteGrenadeTemplates={};
  function activateThrowableAsset(type=selectedThrowable){
    const state=grenadeThrowView.userData.asset;if(!state)return;const record=state.models?.[type]||state.models?.frag_grenade;if(!record)return;
    Object.values(state.models).forEach(value=>value.root.visible=value===record);state.model=record.root;state.grenade=record.root;state.pin=record.pin||null;state.pinBase=state.pin?.position.clone()||null;
    const variant=grenadeViewLayout.variantLayouts?.[type],factor=Number(record.scaleFactor)||1,positionOffset=record.positionOffset||[0,0,0],rotationOffset=record.rotationOffset||[0,0,0];if(variant){state.model.position.fromArray(variant.modelPosition);state.model.rotation.fromArray(variant.modelRotation);state.model.scale.setScalar(Number(variant.modelScale)||1);}else{state.model.position.fromArray(grenadeViewLayout.modelPosition).add(new THREE.Vector3().fromArray(positionOffset));state.model.rotation.fromArray(grenadeViewLayout.modelRotation);state.model.rotation.x+=rotationOffset[0]||0;state.model.rotation.y+=rotationOffset[1]||0;state.model.rotation.z+=rotationOffset[2]||0;state.model.scale.setScalar((Number(grenadeViewLayout.modelScale)||1.2)*factor);}
  }
  function applyGrenadeLayoutLive(value){
    grenadeViewLayout={...grenadeViewLayout,...value};const state=grenadeThrowView.userData.asset;if(!state)return;
    state.root.scale.setScalar(Number(grenadeViewLayout.scale)||.13);state.root.rotation.fromArray(grenadeViewLayout.axisRotation);state.arms.position.fromArray(grenadeViewLayout.armOffset);state.arms.rotation.fromArray(grenadeViewLayout.armRotation);activateThrowableAsset(selectedThrowable);state.grenadeBase.copy(state.model.position);state.grenadeQuaternion.copy(state.model.quaternion);if(state.pin)state.pinBase=state.pin.position.clone();
    Object.entries(grenadeViewLayout.pivotPositions||{}).forEach(([name,position])=>state.arms.getObjectByName(name)?.position.fromArray(position));
    Object.entries(grenadeViewLayout.pivotRotations||{}).forEach(([name,rotation])=>state.arms.getObjectByName(name)?.rotation.fromArray(rotation));
    if(state.leftUpper)state.leftBase={position:state.leftUpper.position.clone(),quaternion:state.leftUpper.quaternion.clone()};
    if(state.rightUpper)state.rightBase={position:state.rightUpper.position.clone(),quaternion:state.rightUpper.quaternion.clone()};
  }
  /** 投掷物只负责装配手臂和独立投掷物；姿态由统一运行时驱动。 */
  async function loadGrenadeThrowAssets(){
    if(!weaponAssetLoader){document.body.dataset.grenadeViewModel='fallback';return false;}
    const load=url=>new Promise((resolve,reject)=>weaponAssetLoader.load(url,resolve,undefined,reject));
    try{
      const manifest=await fetch('assets/weapons/manifest.json',{cache:'no-cache'}).then(response=>response.json()),base=manifest.throwables?.['frag-grenade']?.viewModel;
      if(!base)throw new Error('Throwable manifest is missing frag-grenade');
      const variants=base.variants||{frag_grenade:{modelUrl:base.modelUrl,modelNode:'Grenade',pinNode:'Pin',scaleFactor:1}},variantEntries=Object.entries(variants);
      const [armsGltf,variantGltfs,layout]=await Promise.all([load(base.armsUrl),Promise.all(variantEntries.map(([,variant])=>load(variant.modelUrl))),fetch(base.layoutUrl,{cache:'no-cache'}).then(response=>response.json())]);grenadeViewLayout={...grenadeViewLayout,...layout};
      const arms=armsGltf.scene,dummyNodes=[];
      arms.traverse(object=>{if(object.name==='棱角球')dummyNodes.push(object);if(object.isMesh){if(object.isSkinnedMesh)object.frustumCulled=false;const materials=Array.isArray(object.material)?object.material:[object.material];object.material=materials.map(material=>{const copy=material.clone();copy.depthTest=true;copy.depthWrite=true;if(copy.name==='Shirt')copy.color.set(0x315c78);return copy;});if(object.material.length===1)object.material=object.material[0];}});
      const models={};variantEntries.forEach(([type,variant],index)=>{const root=variantGltfs[index].scene;root.name=`${type}-viewmodel`;root.traverse(object=>{if(object.name==='棱角球')dummyNodes.push(object);if(object.isMesh){const materials=Array.isArray(object.material)?object.material:[object.material];object.material=materials.map(value=>{const copy=value.clone();copy.depthTest=true;copy.depthWrite=true;return copy;});if(object.material.length===1)object.material=object.material[0];}});models[type]={root,pin:variant.pinNode?root.getObjectByName(variant.pinNode):null,scaleFactor:variant.scaleFactor||1,positionOffset:variant.positionOffset||[0,0,0],rotationOffset:variant.rotationOffset||[0,0,0]};remoteGrenadeTemplates[type]=root.clone(true);});
      (base.hiddenNodes||[]).forEach(name=>{const object=arms.getObjectByName(name)||Object.values(models).map(value=>value.root.getObjectByName(name)).find(Boolean);if(object)object.visible=false;});dummyNodes.forEach(object=>object.visible=false);remote.forEach(object=>installRemoteGrenadeModel(object,object.userData.throwableType));grenadeVisualStates.forEach(replaceWorldGrenadeVisual);
      const mixer=new THREE.AnimationMixer(arms),throwClip=armsGltf.animations.find(clip=>clip.name===base.throwAnimation)||armsGltf.animations[0]||null,throwAction=throwClip?mixer.clipAction(throwClip):null;
      if(throwAction){throwAction.play();throwAction.paused=true;throwAction.time=0;mixer.update(0);}
      const assetRoot=new THREE.Group();assetRoot.add(arms);const modelAttachment=base.modelAttachmentNode&&arms.getObjectByName(base.modelAttachmentNode);Object.values(models).forEach(value=>(modelAttachment||assetRoot).add(value.root));
      const leftUpper=arms.getObjectByName(base.nodes?.leftArm||'LeftArmPivot'),rightUpper=arms.getObjectByName(base.nodes?.rightArm||'RightArmPivot');
      const remember=bone=>bone?{position:bone.position.clone(),quaternion:bone.quaternion.clone()}:null;
      const poseBases={};for(const name of['HandL','IndexL','DoubleFingersL','ThumbL','HandR001','IndexR001','DoubleFingersR001','ThumbR001']){const bone=arms.getObjectByName(name);if(bone)poseBases[name]=bone.quaternion.clone();}
      grenadeThrowView.add(assetRoot);grenadeThrowView.userData.asset={root:assetRoot,arms,models,model:null,grenade:null,pin:null,leftUpper,rightUpper,leftBase:remember(leftUpper),rightBase:remember(rightUpper),poseBases,armRig:base.armRig||'SKINNED',mixer,throwClip,throwAction,modelAttachment,grenadeBase:new THREE.Vector3(),grenadeQuaternion:new THREE.Quaternion(),pinBase:null};applyGrenadeLayoutLive(grenadeViewLayout);
      grenadeThrowView.userData.fallback.visible=false;document.body.dataset.grenadeViewModel='asset';return true;
    }catch(error){document.body.dataset.grenadeViewModel='fallback';console.warn('Grenade ViewModel failed; using procedural arms',error);return false;}
  }
  const grenadeAssetsStartedAt=performance.now();
  const grenadeAssetsReady=loadGrenadeThrowAssets().then(result=>{recordAssetTiming('throwableArmsMs',grenadeAssetsStartedAt);return result;});
  const remote = new Map();

  function createRemoteGrenadeFallback(){const group=new THREE.Group(),body=new THREE.Mesh(new THREE.IcosahedronGeometry(.13,1),new THREE.MeshStandardMaterial({color:0x4d6241,metalness:.5,roughness:.42})),cap=new THREE.Mesh(new THREE.BoxGeometry(.08,.05,.16),new THREE.MeshStandardMaterial({color:0xa7aea7,metalness:.82,roughness:.25}));cap.position.y=.15;group.add(body,cap);return group;}
  function throwableWorldModel(type='frag_grenade'){const template=remoteGrenadeTemplates[type]||remoteGrenadeTemplates.frag_grenade,model=template?template.clone(true):createRemoteGrenadeFallback(),factor=THROWABLES[type]?.scaleFactor||1;model.scale.setScalar(template?.24*factor:1);model.rotation.set(0,Math.PI/2,0);return model;}
  function installRemoteGrenadeModel(object,type='frag_grenade'){const mount=object.userData.grenadeMount;if(!mount)return;mount.clear();mount.add(throwableWorldModel(type));object.userData.throwableType=type;}
  function replaceWorldGrenadeVisual(value){if(value.object)scene.remove(value.object);const model=throwableWorldModel(value.type);model.traverse(object=>{if(object.isMesh)object.castShadow=quality.shadows;});value.object=model;scene.add(model);}

  /** 静态枪模尚未加载时仍按资产契约生成可辨认的第三人称轮廓。 */
  function buildRemoteWeaponFallback(weaponId){
    const contract=weaponAssets[weaponId]?.worldModel?.fallback||{},group=new THREE.Group();
    const length=contract.length||1.1,color=contract.color??0x344a63;
    const metal=new THREE.MeshStandardMaterial({color,metalness:.65,roughness:.34});
    const dark=new THREE.MeshStandardMaterial({color:0x151b24,metalness:.72,roughness:.28});
    const receiver=new THREE.Mesh(new THREE.BoxGeometry(.17,.18,length*.62),metal);receiver.position.z=-length*.14;group.add(receiver);
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.025,.035,length*.48,8),dark);barrel.rotation.x=Math.PI/2;barrel.position.z=-length*.65;group.add(barrel);
    if(contract.magazine){const mag=new THREE.Mesh(new THREE.BoxGeometry(.15,.38,.22),dark);mag.position.set(0,-.25,-.03);mag.rotation.x=contract.curvedMagazine?-.38:-.12;group.add(mag);}
    if(contract.scope){const scope=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.38,10),dark);scope.rotation.x=Math.PI/2;scope.position.set(0,.16,-.18);group.add(scope);}
    group.traverse(object=>{if(object.isMesh)object.castShadow=true;});return group;
  }

  /** 切枪或换肤时只替换玩家手上的 WorldModel，不触碰第一人称 ViewModel。 */
  function syncRemoteWeapon(object,weaponId,skinId,force=false){
    if(!force&&object.userData.weaponId===weaponId&&object.userData.skinId===skinId)return;
    const mount=object.userData.weaponMount;if(!mount)return;
    mount.children.forEach(child=>WeaponSkinRuntime?.releaseMaterials?.(child));
    mount.clear();
    const loaded=worldWeaponTemplates[weaponId];
    if(loaded){
      const model=loaded.template.clone(true),config=loaded.config,resolved=resolveSkin(weaponId,skinId);model.scale.setScalar(config.scale||1);model.position.fromArray(config.position||[0,0,0]);model.rotation.fromArray(config.rotation||[0,0,0]);if(resolved)WeaponSkinRuntime.applyMaterials(model,resolved);mount.add(model);skinId=resolved?.skinId||skinId;
    }else mount.add(buildRemoteWeaponFallback(weaponId));
    // 第三人称模型来源和坐标轴并不统一，因此在已经标准化朝向的 weaponMount 上建立
    // 轻量枪口挂点。长度读取同一份 WorldModel 契约，后续换 GLB 不必改曳光弹逻辑。
    const muzzle=new THREE.Object3D(),length=weaponAssets[weaponId]?.worldModel?.fallback?.length||1;
    muzzle.name='RuntimeWorldMuzzle';muzzle.position.set(0,.02,-length);mount.add(muzzle);object.userData.remoteMuzzle=muzzle;
    object.userData.weaponId=weaponId;object.userData.skinId=skinId||null;
  }

  let remoteFaceTexture;
  function getRemoteFaceTexture(){
    if(remoteFaceTexture)return remoteFaceTexture;
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=96;const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;context.clearRect(0,0,128,96);
    // Minecraft-like block features remain readable at distance and cost one shared texture.
    context.fillStyle='#26313c';context.fillRect(22,18,28,34);context.fillRect(78,18,28,34);
    context.fillStyle='#d8ebf1';context.fillRect(29,24,13,15);context.fillRect(85,24,13,15);
    context.fillStyle='#87b7c7';context.fillRect(34,28,8,11);context.fillRect(85,28,8,11);
    context.fillStyle='#8f6f62';context.fillRect(47,67,34,10);context.fillStyle='#b88d78';context.fillRect(56,62,16,5);
    remoteFaceTexture=new THREE.CanvasTexture(canvas);remoteFaceTexture.colorSpace=THREE.SRGBColorSpace;remoteFaceTexture.magFilter=THREE.NearestFilter;remoteFaceTexture.minFilter=THREE.NearestFilter;return remoteFaceTexture;
  }
  function playerMesh(player) {
    const group = new THREE.Group(),visualRoot=new THREE.Group();group.add(visualRoot);group.userData.visualRoot=visualRoot;
    const suit = new THREE.MeshStandardMaterial({ color: 0x24bfe3, emissive: 0x063d54, roughness:.62 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a273, roughness:.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x17243b, roughness:.7 });
    const part=(geometry,material,x,y,z)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.castShadow=true;visualRoot.add(mesh);return mesh;};
    // 方块化比例让轮廓在远距离仍可辨认，后续可直接替换为带骨骼的体素 GLB。
    part(new THREE.BoxGeometry(.72,.78,.42),suit,0,.05,0);
    part(new THREE.BoxGeometry(.58,.58,.58),skin,0,.72,0);
    const face=new THREE.Mesh(new THREE.PlaneGeometry(.52,.39),new THREE.MeshBasicMaterial({map:getRemoteFaceTexture(),transparent:true,alphaTest:.1,side:THREE.DoubleSide}));face.position.set(0,.72,-.296);visualRoot.add(face);
    const leftArm=part(new THREE.BoxGeometry(.19,.72,.2),suit,-.43,.13,-.28);leftArm.rotation.set(-1.02,0,-.11);
    const throwArm=part(new THREE.BoxGeometry(.19,.72,.2),suit,.43,.13,-.28);throwArm.rotation.set(-1.02,0,.11);group.userData.throwArm=throwArm;group.userData.throwArmBaseRotation=throwArm.rotation.clone();
    part(new THREE.BoxGeometry(.25,.72,.28),dark,-.2,-.69,0);part(new THREE.BoxGeometry(.25,.72,.28),dark,.2,-.69,0);
    // WorldModel 挂点跟随人物朝向。未来替换骨骼角色时，这个 Group 会改挂到 RightHand 骨骼。
    const weaponMount=new THREE.Group();weaponMount.position.set(.43,.16,-.48);visualRoot.add(weaponMount);group.userData.weaponMount=weaponMount;
    const grenadeMount=new THREE.Group();grenadeMount.position.set(.48,.36,-.42);grenadeMount.visible=false;visualRoot.add(grenadeMount);group.userData.grenadeMount=grenadeMount;installRemoteGrenadeModel(group);
    const shield = new THREE.Mesh(new THREE.SphereGeometry(.9,16,12),new THREE.MeshBasicMaterial({color:0x55eaff,transparent:true,opacity:.14,wireframe:true}));shield.visible=false;group.add(shield);group.userData.shield=shield;
    const tag = document.createElement('canvas'); tag.width = 256; tag.height = 64;
    const context = tag.getContext('2d'); context.font = 'bold 28px sans-serif'; context.textAlign = 'center'; context.fillStyle = '#fff'; context.fillText(player.name, 128, 38);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tag), transparent: true })); label.position.y = 1.45; label.scale.set(3, .75, 1); visualRoot.add(label);
    group.userData.stealthMaterials=[suit,skin,dark,face.material];group.userData.nameLabel=label;group.userData.wasAlive=player.alive;group.userData.deathStartedAt=0;
    scene.add(group);const currentWeapon=player.weapon||'m4a1';syncRemoteWeapon(group,currentWeapon,player.skinId||player.equippedSkins?.[currentWeapon]);return group;
  }

  /** 优先连接 Netty :8081；连接失败时回退到原 Spring WebSocket，保证可回滚。 */
  function rejectMapMismatch(serverMap){
    mapCompatible=false;id=undefined;firing=false;
    ['play','spectate'].forEach(buttonId=>{const button=$(buttonId);button.disabled=true;button.title='地图版本不一致，请刷新页面';});
    $('status').textContent='地图已更新，请刷新页面后再进入战斗';$('status').style.color='#ff647c';
    console.error('客户端与服务端地图身份不一致',{client:MAP_IDENTITY,server:serverMap});
  }
  /**
   * 地图决定了客户端画面和服务端权威碰撞。三项身份必须全部相同，
   * 否则禁止 join，避免旧标签页中出现穿墙、浮空或命中判定偏差。
   */
  function validateServerMap(data){
    const serverMap={id:String(data.mapId??''),revision:Number(data.mapRevision),contentHash:String(data.mapContentHash??'').toLowerCase().replace(/^sha-256:/,'')};
    const valid=data.roomId===selectedRoomId&&serverMap.id===MAP_IDENTITY.id&&Number.isFinite(serverMap.revision)&&serverMap.revision===MAP_IDENTITY.revision&&serverMap.contentHash===MAP_IDENTITY.contentHash;
    if(!valid){rejectMapMismatch(serverMap);return false;}
    mapCompatible=true;['play','spectate'].forEach(buttonId=>{const button=$(buttonId);button.disabled=false;button.title='';});if(pendingEntryMode){sessionStorage.removeItem('zeroPendingEntryMode');setTimeout(()=>enterGame(pendingEntryMode==='spectate'),80);}return true;
  }
  function transportUrl(preferred,protocol,roomQuery){
    // Port 8080 is the bundled local/LAN developer deployment, where Netty is
    // intentionally exposed on 8081. Public HTTP(S) deployments stay on the
    // current origin: Nginx routes /ws/game to Netty and keeps the Spring
    // emergency path private behind /ws-fallback/game.
    const directDeveloperPorts=location.port==='8080';
    if(directDeveloperPorts&&preferred==='netty')return `${protocol}://${location.hostname}:8081/ws/game${roomQuery}`;
    const path=preferred==='netty'?'/ws/game':'/ws-fallback/game';
    return `${protocol}://${location.host}${path}${roomQuery}`;
  }
  function connect(preferred = 'netty') {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const roomQuery=`?room=${encodeURIComponent(selectedRoomId)}`;
    const url=transportUrl(preferred,protocol,roomQuery);
    ws = new WebSocket(url);
    ws.onopen = () => { activeTransport=preferred;$('status').textContent = `${preferred==='netty'?'Netty':'Spring'} 服务器已连接 · 准备战斗`; $('status').style.color = '#5effa1'; };
    // Alternate transports while the process is restarting. Once Netty returns,
    // the client can move back from the Spring fallback without a page refresh.
    ws.onclose = () => { rejectAuthoritativeEntry(new Error('连接已断开'));$('status').textContent = '连接已断开，正在重连...'; setTimeout(()=>connect(preferred==='netty'?'spring':'netty'), 1500); };
    ws.onmessage = event => message(JSON.parse(event.data));
  }
  function message(data) {
    if (data.type === 'welcome') { if(!validateServerMap(data))return;id = data.id;applyCatalog(data.weaponCatalog);applySelf(data.player, true);applyMatchState(data.match);if(data.version){$('clientVersion').textContent=`CLIENT BUILD v${data.version}`;const previous=localStorage.getItem('neonArenaServerVersion');localStorage.setItem('neonArenaServerVersion',data.version);if(previous&&previous!==data.version)chat(`服务器已从 ${previous} 升级到 ${data.version}。`,true);} }
    else if (data.type === 'spawn') {if(!spectating){applySelf(data.player, true);showBuffSelection(data.player);}resolveAuthoritativeEntry();}
    else if (data.type === 'buff_selected') {applySelf(data.player);hideBuffSelection(false);showWeaponState(data.player.spawnBuff==='NONE'?'已跳过出生增益':'出生增益已锁定');}
    else if (data.type === 'state') {const receivedAt=performance.now();if(lastStateReceivedAt)maxSnapshotGapMs=Math.max(maxSnapshotGapMs,receivedAt-lastStateReceivedAt);lastStateReceivedAt=receivedAt;latestPlayers=data.players||[];updatePlayers(latestPlayers); updateItems(data.items);updateGrenades(data.grenades||[]);updateSmokes(data.smokes||[]);applyMatchState(data.match);serverStats=`${activeTransport.toUpperCase()} · TICK ${(data.tickMicros/1000).toFixed(2)}ms · Q ${data.queueDepth}`; }
    else if (data.type === 'match_phase') applyMatchState(data.match);
    else if (data.type === 'match_finished') {applyMatchState(data.match);showMatchResult(data);}
    else if (data.type === 'pong') {const sample=Math.max(1,Date.now()-data.clientTime);pingSamples.push(sample);if(pingSamples.length>5)pingSamples.shift();const sorted=[...pingSamples].sort((a,b)=>a-b);pingMs=sorted[Math.floor((sorted.length-1)/2)];updateNetworkStatus();}
    else if (data.type === 'join_rejected') {rejectAuthoritativeEntry(new Error(data.reason||'join_rejected'));handleJoinRejected(data);}
    else if (data.type === 'pickup') { applySelf(data.player); showPickup(data.weapon,data.replacedWeapon,data.itemType); }
    else if (data.type === 'skin_equipped') { if(data.playerId===id){applySelf(data.player);showWeaponState('武器外观已装备');}else{const object=remote.get(data.playerId),remoteWeapon=data.player?.weapon||data.weapon;if(object)syncRemoteWeapon(object,remoteWeapon,data.player?.skinId||data.skinId,true);} }
    else if (data.type === 'skin_rejected') showWeaponState('该武器外观不可用');
    else if (data.type === 'shot_rejected') {lastResolvedShotId=Math.max(lastResolvedShotId,data.shotId||0);if(data.reason!=='cooldown')showWeaponState(data.reason==='buff_jammed'?`出生增益：武器卡顿 ${(data.remainingMs/1000).toFixed(1)}s`:data.reason==='cycling'?`拉栓中 ${(data.remainingMs/1000).toFixed(1)}s`:data.reason==='throwing_grenade'?'投掷手雷中':data.reason==='equipping'?'切枪中':data.reason==='reloading'?'换弹中':data.reason==='direction'?'视角尚未同步':data.reason==='replay'?'射击序号无效':'弹匣为空');}
    else if (data.type === 'shot') {tracer(data);playGunSound(data.weapon,new THREE.Vector3(data.ox,data.oy,data.oz));}
    else if (data.type === 'melee_swing') {if(data.id!==id){const source=remote.get(data.id);playMeleeWhoosh(source?source.position:null,.3);}}
    else if (data.type === 'shot_result') showShotResult(data);
    else if (data.type === 'buff_triggered') showBuffTriggered(data);
    else if (data.type === 'bot_configured') {appSettings.training.botDifficulty=data.difficulty;saveSettings();syncSettingsUI();showWeaponState(`机器人难度：${{OFF:'关闭',EASY:'简单',HARD:'困难',INFERNO:'炼狱'}[data.difficulty]||data.difficulty}`);}
    else if (data.type === 'bot_config_rejected') showWeaponState('真人对局中不能修改机器人难度');
    else if (data.type === 'damage_taken') {lastDamageTaken=data;showDamageTaken(data);}
    else if (data.type === 'grenade_exploded') spawnGrenadeExplosion(data);
    else if (data.type === 'flash_detonated') spawnFlashDetonation(data);
    else if (data.type === 'flash_effect') applyFlashEffect(data);
    else if (data.type === 'smoke_started') registerSmoke(data);
    else if (data.type === 'hit') showConfirmedHit(data);
    else if (data.type === 'kill') showKill(data);
    else if (data.type === 'chat') chat(`<b>${escapeHtml(data.name)}</b>: ${escapeHtml(data.text)}`);
    else if (data.type === 'system') chat(escapeHtml(data.text), true);
  }
  function handleJoinRejected(data){
    playing=false;spectating=false;firing=false;hideBuffSelection(false);releaseGamePointerLock();
    $('hud').classList.add('hidden');$('spectatorHud').classList.add('hidden');$('menu').classList.remove('hidden');
    const full=data.reason==='spectator_full'?'Spectator capacity reached':'Room is full';
    $('status').textContent=`${full} (${data.current||0}/${data.capacity||0})`;$('status').style.color='#ffb45e';refreshPublicStatus();
  }

  /**
   * 服务端快照携带“收到这一刻还剩多少毫秒”，客户端只在两次快照之间本地递减，
   * 不直接拿设备 Date.now 与服务器时间相减，避免玩家系统时钟不准导致倒计时跳动。
   */
  function applyMatchState(next){
    if(!next)return;const previous=currentMatch.phase;currentMatch={...currentMatch,...next};matchReceivedAt=performance.now();
    if(currentMatch.phase==='FINISHED'&&playing&&!matchFinished){
      matchFinished=true;firing=false;scope(false);hideBuffSelection(false);clearInterval(respawnTimer);dead=false;$('death').classList.add('hidden');Object.keys(keys).forEach(key=>keys[key]=false);releaseGamePointerLock();
    }else if(previous==='FINISHED'&&currentMatch.phase!=='FINISHED'){
      matchFinished=false;$('matchResult').classList.add('hidden');
      if(playing&&!spectating&&!settingsOpen)setTimeout(requestGamePointerLock,0);
    }
    if(previous==='WARMUP'&&currentMatch.phase==='PLAYING'&&playing&&!spectating)showRoundStart();
  }

  function showRoundStart(){const node=$('roundStart');clearTimeout(roundStartTimer);node.classList.remove('hidden');roundStartTimer=setTimeout(()=>node.classList.add('hidden'),1650);}

  function matchRemainingMs(){return Math.max(0,(currentMatch.remainingMs||0)-(performance.now()-matchReceivedAt));}
  function formatMatchTime(milliseconds){const total=Math.max(0,Math.ceil(milliseconds/1000)),minutes=Math.floor(total/60),seconds=total%60;return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;}
  function updateMatchHud(){
    if(!playing)return;const labels={WAITING:'等待玩家',WARMUP:'热身',PLAYING:`第 ${currentMatch.round||1} 局`,FINISHED:'本局结束'},remaining=matchRemainingMs();
    $('matchPhase').textContent=labels[currentMatch.phase]||currentMatch.phase;
    $('matchTimer').textContent=currentMatch.phase==='WAITING'?'--:--':formatMatchTime(remaining);
    if(currentMatch.phase==='PLAYING')$('matchGoal').textContent=`目标 ${currentMatch.scoreLimit} 击杀 · 领先 ${currentMatch.leaderKills||0}`;
    else if(currentMatch.phase==='WAITING')$('matchGoal').textContent=`${currentMatch.playerCount||0} / ${currentMatch.minPlayers||1} 玩家`;
    else $('matchGoal').textContent=currentMatch.phase==='WARMUP'?'击杀不计分':'下一局自动开始';
    if(currentMatch.phase==='FINISHED')$('matchNextRound').textContent=`${Math.ceil(remaining/1000)} 秒后开始下一局`;
  }

  /** 卡片只展示服务端下发的剩余窗口；选择成功也必须等待 buff_selected 确认。 */
  function showBuffSelection(player){
    const remaining=Number(player?.spawnBuffSelectionRemainingMs||0);
    if(!playing||spectating||!currentMatch.buffsEnabled||player?.spawnBuffSelected||remaining<=0){hideBuffSelection(false);return;}
    buffSelectionDuration=remaining;buffSelectionDeadline=performance.now()+remaining;buffSelectionPending=false;
    document.querySelectorAll('.buff-cards button').forEach(button=>button.disabled=false);
    $('buffSelection').classList.remove('hidden');firing=false;scope(false);releaseGamePointerLock();updateBuffSelection();
  }
  function hideBuffSelection(resume){
    buffSelectionDeadline=0;buffSelectionDuration=0;buffSelectionPending=false;$('buffSelection').classList.add('hidden');
  }
  function updateBuffSelection(){
    if($('buffSelection').classList.contains('hidden'))return;
    const remaining=Math.max(0,buffSelectionDeadline-performance.now());$('buffCountdown').textContent=(remaining/1000).toFixed(1)+'s';
    $('buffCountdownProgress').style.transform=`scaleX(${buffSelectionDuration?remaining/buffSelectionDuration:0})`;
    if(remaining<=0)hideBuffSelection(false);
  }

  function showMatchResult(data){
    if(!playing)return;const standings=data.standings||[],winner=data.winnerId===id;
    $('matchResultReason').textContent=data.reason==='SCORE_LIMIT'?'达到击杀目标':'比赛时间结束';
    $('matchResultTitle').textContent=winner?'本局胜利':data.winnerName?`${data.winnerName} 获胜`:'比赛结算';
    $('matchStandings').innerHTML=standings.map((entry,index)=>`<div class="match-result-row ${entry.id===id?'me':''} ${index===0?'winner':''}"><b>${entry.place}</b><span>${escapeHtml(entry.name)}</span><span>击杀 ${entry.kills}</span><span>死亡 ${entry.deaths}</span></div>`).join('');
    $('matchResult').classList.remove('hidden');
  }
  function applyCatalog(catalog=[]){if(!catalog.length)return;WEAPONS=weaponController.replace(catalog);catalog.forEach(config=>{buildWeaponView(config.id);loadWeaponContract(config.id);});}
  function weaponThumbnail(weaponId){return `assets/ui/weapons/${encodeURIComponent(weaponId)}.png`;}
  function renderLoadout(player){
    const now=Date.now(),localThrowing=localGrenadeThrowStartedAt>0&&now<localGrenadeThrowStartedAt+THROW_DURATION_MS,throwing=player.weaponAction==='THROWING_GRENADE'||localThrowing||throwableEquipped,current=WEAPONS[weapon]||{},currentSlot=current.slot||'PRIMARY',slotKey={PRIMARY:'1',SECONDARY:'2',MELEE:'3'}[currentSlot]||'';
    const currentIcon=$('currentWeaponIcon');currentIcon.src=weaponThumbnail(weapon);currentIcon.alt=current.name||weapon;$('currentSlotLabel').textContent=`${currentSlot} · ${slotKey}`;
    ['PRIMARY','SECONDARY','MELEE'].forEach(slot=>{
      const id=equippedSlots[slot],node=document.querySelector(`#weaponSlots [data-slot="${slot}"]`),prefix=slot.toLowerCase(),nameNode=$(`${prefix}SlotName`),icon=$(`${prefix}SlotIcon`);if(!node||!nameNode)return;
      nameNode.textContent=id?(WEAPONS[id]?.name||id):(slot==='MELEE'?'近战空槽':'未装备');node.classList.toggle('empty',!id);node.classList.toggle('active',!throwing&&id===weapon);
      if(icon){if(id){icon.src=weaponThumbnail(id);icon.alt=WEAPONS[id]?.name||id;}else{icon.removeAttribute('src');icon.alt='';}}
    });
    const throwable=document.querySelector('#weaponSlots [data-slot="THROWABLE"]'),definition=THROWABLES[selectedThrowable]||THROWABLES.frag_grenade,count=throwableInventory[selectedThrowable]||0,total=Object.values(throwableInventory).reduce((sum,value)=>sum+(Number(value)||0),0);throwable.classList.toggle('active',throwing);throwable.classList.toggle('empty',total<=0&&!throwing);$('grenadeCount').textContent=`${definition.name} ×${count}`;
  }
  /**
   * 使用服务端快照校正本地预测：先丢弃已确认输入，再以服务端位置为起点
   * 重放尚未确认的输入。视觉偏移单独缓慢衰减，避免逻辑位置纠正时画面瞬移。
   */
  function applySelf(player, teleport = false) {
    if (!player) return;const previousPlayer=me,previousWeaponAction=me?.weaponAction;me = player;
    // The immediate kill event drives the rich report, but the authoritative snapshot must
    // also be able to enter the death state. This prevents a delayed event/backlogged tab
    // from silently remaining alive until the later spawn message teleports it.
    if(playing&&!spectating&&!player.alive&&!dead){deathReconciliationCount++;die({killer:lastDamageTaken?.attacker||'未知攻击者',weapon:lastDamageTaken?.weapon,headshot:!!lastDamageTaken?.headshot,distance:lastDamageTaken?.distance,respawnDelayMs:Math.max(0,player.respawnRemainingMs??3000),reconciled:true});}
    if(player.alive&&previousPlayer&&!previousPlayer.alive)lastDamageTaken=null;
    if(!grenadePriming&&!localGrenadeThrowStartedAt&&player.weaponAction!=='THROWING_GRENADE'&&typeof player.holdingThrowable==='boolean')throwableEquipped=player.holdingThrowable;document.body.dataset.weaponAction=player.weaponAction||'READY';document.body.dataset.weaponActionStartedAt=String(player.weaponActionStartedAt||0);
    if(player.weaponAction==='RELOADING'&&previousWeaponAction!=='RELOADING'&&libraryAudioBuffers['reload-v2.ogg'])playLibrarySound('reload-v2.ogg',null,weaponAudioConfig(player.weapon).reloadVolume??.72,0);
    if (teleport) {
      // 复活快照同时应用服务端选择的出生朝向，位置与相机不会各自沿用不同出生状态。
      Object.assign(state, { x: player.x, y: player.y, z: player.z, yaw:player.yaw||0,
        pitch:player.pitch||0, vy: 0, onGround: true });
      pendingInputs = [];
      inputAccumulator = 0;
      renderCorrection.set(0, 0, 0);
    } else if (playing && player.alive) {
      const before = { x: state.x, y: state.y, z: state.z };
      pendingInputs = pendingInputs.filter(input => input.sequence > (player.ackSequence || 0));
      Object.assign(state, { x: player.x, y: player.y, z: player.z, vy: player.verticalVelocity || 0, onGround: !!player.onGround });
      pendingInputs.forEach(input => simulateMovement(state, input, INPUT_INTERVAL));
      const current = currentInput(false);
      if (inputAccumulator > 0) simulateMovement(state, current, inputAccumulator);
      const error = Math.hypot(before.x-state.x, before.y-state.y, before.z-state.z);
      if(error>.025){correctionCount++;correctionDistance+=error;}
      // Do not visually smooth every centimetre of normal prediction error. At a
      // 10 Hz snapshot rate those tiny offsets used to accumulate faster than
      // they decayed, which made walking feel sticky even while FPS stayed near
      // 60. The authoritative state is still applied above; this only changes
      // how much reconciliation is shown by the camera.
      if(error<5&&error>.075){
        renderCorrection.add(new THREE.Vector3(before.x-state.x,before.y-state.y,before.z-state.z));
        renderCorrection.clampLength(0,.32);
      }else if(error>=5)renderCorrection.set(0,0,0);
    }
    weapon = player.weapon || 'm4a1'; ammo = player.ammo ?? ammo;reserveAmmo=player.reserveAmmo??reserveAmmo;throwableInventory={...throwableInventory,...(player.throwables||{})};if(!throwableEquipped&&player.selectedThrowable)selectedThrowable=player.selectedThrowable;
    const previousSkins=equippedSkins;equippedSkins={...(player.equippedSkins||{})};equippedSlots={...(player.equippedSlots||{})};weaponInventory=Object.fromEntries((player.weaponStates||[]).map(state=>[state.id,state]));for(const weaponId of new Set([...Object.keys(previousSkins),...Object.keys(equippedSkins)]))if(previousSkins[weaponId]!==equippedSkins[weaponId])applyViewSkin(weaponId,equippedSkins[weaponId]);
    ownedWeapons = new Set(player.weapons || ['m4a1']);
    $('weaponName').textContent = WEAPONS[weapon].name; const meleeHud=WEAPONS[weapon]?.category==='MELEE';$('ammo').textContent = meleeHud?'—':ammo;$('reserveAmmo').textContent=meleeHud?'—':(reserveAmmo<0?'∞':reserveAmmo);renderLoadout(player);
    syncCrosshairVisibility(); updateHud();
    const now=Date.now(),localThrowInFlight=localGrenadeThrowStartedAt>0&&now<localGrenadeThrowStartedAt+THROW_DURATION_MS*.98,serverThrowWithoutPrediction=player.weaponAction==='THROWING_GRENADE'&&!localGrenadeThrowStartedAt;
    Object.entries(weaponViews).forEach(([id,view])=>view.visible=id===weapon&&!throwableEquipped&&!localThrowInFlight&&!serverThrowWithoutPrediction);
  }
  function updatePlayers(players) {
    const seen = new Set();
    players.forEach(player => {
      if (player.id === id) { applySelf(player); return; }
      seen.add(player.id); let object = remote.get(player.id);
      const target = new THREE.Vector3(player.x, player.y - .7, player.z);
      if (!object) { object = playerMesh(player);object.position.copy(target);object.rotation.y=player.yaw;remote.set(player.id, object); }
      // 复活时模型仍处于隐藏状态，先瞬间放到新出生点再显示，避免从死亡点滑过地图。
      const previousTarget=object.userData.target,now=performance.now(),wasAlive=object.userData.wasAlive;
      if(player.alive&&!wasAlive){object.position.copy(target);object.userData.deathStartedAt=0;object.userData.visualRoot.position.set(0,0,0);object.userData.visualRoot.rotation.set(0,0,0);}
      if(!player.alive&&wasAlive){object.userData.deathStartedAt=now;object.userData.deathDirection=player.id.split('').reduce((sum,value)=>sum+value.charCodeAt(0),0)%2?1:-1;object.userData.weaponMount.visible=false;object.userData.grenadeMount.visible=false;}
      if(player.alive&&previousTarget&&previousTarget.distanceToSquared(target)>.012&&now>=(object.userData.nextFootstepAt||0)){playFootstepSound(false,target);object.userData.nextFootstepAt=now+340;}
      const deathAnimating=!player.alive&&object.userData.deathStartedAt>0&&now-object.userData.deathStartedAt<850;object.visible=(player.alive||deathAnimating)&&!(spectating&&spectatorMode==='FOLLOW'&&spectatorTargetId===player.id);object.userData.wasAlive=player.alive;object.userData.target = target; object.userData.yaw = player.yaw;object.userData.pitch=player.pitch||0;object.userData.playerName=player.name;const currentWeapon=player.weapon||'m4a1';syncRemoteWeapon(object,currentWeapon,player.skinId||player.equippedSkins?.[currentWeapon]);
      const invisible=!!player.invisibleActive;if(object.userData.invisibleActive!==invisible){object.userData.invisibleActive=invisible;for(const material of object.userData.stealthMaterials||[]){material.transparent=invisible;material.opacity=invisible?.24:1;material.depthWrite=!invisible;material.needsUpdate=true;}if(object.userData.nameLabel)object.userData.nameLabel.material.opacity=invisible?.18:1;}
      const throwing=player.weaponAction==='THROWING_GRENADE',throwableType=player.selectedThrowable||'frag_grenade',start=player.weaponActionStartedAt||0,end=player.weaponActionUntil||0,commit=player.weaponActionCommitAt||0,progress=end>start?THREE.MathUtils.clamp((Date.now()-start)/(end-start),0,1):0,committed=commit>0&&Date.now()>=commit,arc=Math.sin(Math.PI*progress);if(object.userData.throwableType!==throwableType)installRemoteGrenadeModel(object,throwableType);object.userData.weaponMount.visible=player.alive&&!throwing;object.userData.grenadeMount.visible=player.alive&&throwing&&!committed;object.userData.grenadeMount.position.set(.48,.36+arc*.42,-.42-arc*.32);object.userData.grenadeMount.rotation.set(-arc*1.1,0,-arc*.35);const armBase=object.userData.throwArmBaseRotation;object.userData.throwArm.rotation.x=armBase.x-arc*.72;object.userData.throwArm.rotation.z=armBase.z-arc*.24;
      if(object.userData.shield)object.userData.shield.visible=player.alive&&Date.now()<(player.invulnerableUntil||0);
    });
    for (const [playerId, object] of remote) if (!seen.has(playerId)) { scene.remove(object); remote.delete(playerId); }
    renderScores(players);
  }
  function updateItems(items = []) {
    // Snapshot schema v2 sends only mutable state for map-authored pickups. Rebuild
    // their immutable type and position from the already verified map definition.
    worldItems=items.map(item=>{
      if(item.dynamic)return item;
      const definition=pickupDefinitionsById.get(item.id),position=definition?.position||[item.x||0,0,item.z||0];
      return {...item,itemType:item.itemType||definition?.itemType||(definition?.weaponId?'WEAPON':''),weapon:item.weapon||definition?.weaponId||'',x:item.x??position[0],z:item.z??position[2],dynamic:false};
    });const seen=new Set();
    worldItems.forEach(item=>{
      seen.add(item.id);
      if(!pickupMeshes[item.id]&&item.dynamic){
        const accent=WEAPONS[item.weapon]?.fallbackColor||0x65dce6;
        const mesh=createPickupCrate(item.id,accent,[item.x,0,item.z]);mesh.userData.dynamic=true;mesh.userData.itemName=WEAPONS[item.weapon]?.name||item.weapon;pickupMeshes[item.id]=mesh;
      }
      const mesh=pickupMeshes[item.id];if(mesh)mesh.visible=item.available;
    });
    Object.entries(pickupMeshes).forEach(([itemId,mesh])=>{
      if(!mesh.userData.dynamic||seen.has(itemId))return;
      scene.remove(mesh);mesh.traverse(object=>{if(object.isMesh&&object.material!==pickupCrateBodyMaterial)object.material.dispose?.();});delete pickupMeshes[itemId];
    });
  }
  function updateGrenades(items=[]){const seen=new Set(),receivedAt=performance.now();items.forEach(item=>{seen.add(item.id);let value=grenadeVisualStates.get(item.id),target=new THREE.Vector3(item.x,item.y,item.z),type=item.throwable||'frag_grenade';if(!value){value={type,position:target.clone(),target,velocity:new THREE.Vector3(),receivedAt,object:null};grenadeVisualStates.set(item.id,value);replaceWorldGrenadeVisual(value);}else{if(value.type!==type){value.type=type;replaceWorldGrenadeVisual(value);}const elapsed=Math.max(.035,(receivedAt-value.receivedAt)/1000);value.velocity.copy(target).sub(value.target).multiplyScalar(1/elapsed);value.target.copy(target);value.receivedAt=receivedAt;}});for(const [grenadeId,value] of grenadeVisualStates)if(!seen.has(grenadeId)){if(value.object)scene.remove(value.object);grenadeVisualStates.delete(grenadeId);}}
  function updateGrenadeVisuals(dt){const now=performance.now(),blend=1-Math.exp(-22*dt),predicted=new THREE.Vector3();for(const value of grenadeVisualStates.values()){const extrapolation=Math.min(.12,Math.max(0,(now-value.receivedAt)/1000));predicted.copy(value.target).addScaledVector(value.velocity,extrapolation);value.position.lerp(predicted,blend);if(value.object)value.object.position.copy(value.position);}}
  function registerSmoke(data){const now=performance.now(),existing=smokeVisualStates.get(data.id);if(existing){existing.x=data.x;existing.y=data.y;existing.z=data.z;existing.radius=data.radius||3.8;existing.expiresAt=Math.max(existing.expiresAt,now+(data.durationMs||data.remainingMs||0));return;}smokeVisualStates.set(data.id,{id:data.id,x:data.x,y:data.y,z:data.z,radius:data.radius||3.8,startedAt:now,expiresAt:now+(data.durationMs||data.remainingMs||12_000)});}
  function updateSmokes(items=[]){const seen=new Set();items.forEach(item=>{seen.add(item.id);registerSmoke({...item,durationMs:item.remainingMs})});for(const [smokeId] of smokeVisualStates)if(!seen.has(smokeId))smokeVisualStates.delete(smokeId);}
  function updateSmokeVisuals(time){let index=0,insideOpacity=0;for(const [id,smoke] of smokeVisualStates){if(time>=smoke.expiresAt){smokeVisualStates.delete(id);continue;}const age=Math.max(0,(time-smoke.startedAt)/1000),growth=Math.min(1,age/1.9),fade=Math.min(1,(smoke.expiresAt-time)/900),activeRadius=Math.max(.2,smoke.radius*growth),cameraDistance=Math.hypot(camera.position.x-smoke.x,camera.position.z-smoke.z);if(cameraDistance<activeRadius)insideOpacity=Math.max(insideOpacity,(.68+.3*(1-cameraDistance/activeRadius))*fade);const smokePuffs=qualityName==='low'?14:qualityName==='medium'?20:24;for(let puff=0;puff<smokePuffs&&index<MAX_SMOKE_PLANES;puff++){const angle=puff*2.399963+id*.37,layer=puff%6,radial=.04+.72*((puff%12)/11),spread=THREE.MathUtils.clamp(growth*1.42-radial*.32,0,1);if(spread<=.02)continue;const radius=smoke.radius*radial*growth,wave=Math.sin(time*.00012+puff*1.7+id)*.035;smokeDummy.position.set(smoke.x+Math.cos(angle)*radius,smoke.y+.48+layer*.32*spread+wave,smoke.z+Math.sin(angle)*radius);const size=(2.75+(puff%4)*.34)*(.25+.75*spread)*fade;smokeDummy.scale.set(size*1.34,size,1);smokeDummy.quaternion.copy(camera.quaternion);smokeDummy.rotateZ(angle*.19);smokeDummy.updateMatrix();smokeBatch.setMatrixAt(index++,smokeDummy.matrix);}}smokeBatch.count=index;smokeBatch.instanceMatrix.needsUpdate=true;const veil=$('smokeVeil'),next=insideOpacity.toFixed(3);if(veil.style.getPropertyValue('--smoke-opacity')!==next)veil.style.setProperty('--smoke-opacity',next);}
  const _poseOffset=new THREE.Vector3(),_poseQuat=new THREE.Quaternion(),_poseEuler=new THREE.Euler();
  /**
   * 军刀第一人称：复用投掷物那套已校准的右臂，把手雷换成一把程序化建模的军刀。
   * 刀柄中心放在手雷原本的握持点，刀身朝前上方；挥刀动作只驱动整个视图节点，
   * 不改手臂骨骼，因此不会破坏手雷的校准。外观只是表现，命中完全由服务端判定。
   */
  const KNIFE_SWING_MS=360,KNIFE_STRIKE_START=.2,KNIFE_STRIKE_END=.55;
  let knifeSwingStartedAt=0,knifeModeActive=false;
  const knifeView=createKnifeModel();knifeView.visible=false;grenadeThrowView.add(knifeView);
  function createKnifeModel(){
    const group=new THREE.Group(),steel=new THREE.MeshStandardMaterial({color:0xb9c1c6,metalness:.86,roughness:.28}),dark=new THREE.MeshStandardMaterial({color:0x1d2226,metalness:.25,roughness:.72}),guardMaterial=new THREE.MeshStandardMaterial({color:0x3a4045,metalness:.7,roughness:.4});
    const handle=new THREE.Mesh(new THREE.CylinderGeometry(.0135,.015,.1,8),dark);handle.position.y=0;
    for(let i=0;i<4;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(.0148,.0022,4,10),dark);ring.rotation.x=Math.PI/2;ring.position.y=-.035+i*.023;group.add(ring);}
    const pommel=new THREE.Mesh(new THREE.CylinderGeometry(.017,.015,.014,8),guardMaterial);pommel.position.y=-.057;
    const guard=new THREE.Mesh(new THREE.BoxGeometry(.068,.011,.02),guardMaterial);guard.position.y=.055;
    const shape=new THREE.Shape();shape.moveTo(-.015,0);shape.lineTo(.016,0);shape.lineTo(.016,.13);shape.quadraticCurveTo(.012,.17,0,.19);shape.lineTo(-.006,.165);shape.lineTo(-.015,.14);shape.lineTo(-.015,0);
    const bladeGeometry=new THREE.ExtrudeGeometry(shape,{depth:.0045,bevelEnabled:true,bevelThickness:.0018,bevelSize:.0018,bevelSegments:1,curveSegments:6});bladeGeometry.translate(0,0,-.00225);
    const blade=new THREE.Mesh(bladeGeometry,steel);blade.position.y=.06;
    group.add(handle,pommel,guard,blade);group.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=false;}});group.scale.setScalar(.9);return group;
  }
  /** 刀身方向在相机空间中定义（前上方、略向左），再换算到手臂视图节点的本地空间。 */
  function placeKnifeInHand(){
    const asset=grenadeThrowView.userData.asset,baseQuaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(grenadeViewLayout.viewRotation||[0,0,0]));
    const up=new THREE.Vector3(-.05,.45,-.9).normalize(),side=new THREE.Vector3(.6,0,.8);side.addScaledVector(up,-side.dot(up)).normalize();const across=new THREE.Vector3().crossVectors(up,side);
    const cameraQuaternion=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,up,side));
    knifeView.quaternion.copy(baseQuaternion.clone().invert().multiply(cameraQuaternion));
    // 以破片手雷的校准握点为准，临时激活它来读取位置，退出持刀时再恢复当前投掷物。
    if(asset?.models?.frag_grenade)activateThrowableAsset('frag_grenade');
    const holdModel=asset?.models?.frag_grenade?.root||asset?.model;
    if(holdModel){grenadeThrowView.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(holdModel).getCenter(new THREE.Vector3());grenadeThrowView.worldToLocal(center);knifeView.position.copy(center);knifeView.userData.placed=true;}
    else{const fallback=grenadeThrowView.userData.grenade;knifeView.position.copy(fallback.position).add(new THREE.Vector3(0,-.02,0));knifeView.userData.placed=false;}
  }
  function exitKnifeMode(){if(!knifeModeActive)return;knifeModeActive=false;knifeView.visible=false;knifeSwingStartedAt=0;activateThrowableAsset(selectedThrowable);const fallback=grenadeThrowView.userData;if(fallback.grenade)fallback.grenade.visible=true;if(fallback.ring)fallback.ring.visible=true;}
  function updateKnifeView(){
    const asset=grenadeThrowView.userData.asset,layoutPosition=grenadeViewLayout.viewPosition,layoutRotation=grenadeViewLayout.viewRotation;
    grenadeThrowView.visible=true;grenadeThrowView.position.fromArray(layoutPosition);grenadeThrowView.rotation.fromArray(layoutRotation);
    if(asset){
      asset.root.position.set(0,0,0);asset.root.rotation.fromArray(grenadeViewLayout.axisRotation);
      if(asset.rightUpper){asset.rightUpper.visible=true;if(asset.rightBase){asset.rightUpper.position.copy(asset.rightBase.position);asset.rightUpper.quaternion.copy(asset.rightBase.quaternion).multiply(_poseQuat.setFromEuler(_poseEuler.set(0,0,.18)));}}
      if(asset.leftUpper)asset.leftUpper.visible=false;
      if(asset.armRig!=='ANIMATED_SKINNED')poseGrenadeHands(asset,0,0);
    }
    if(!knifeModeActive||(asset&&!knifeView.userData.placed)){knifeModeActive=true;placeKnifeInHand();}
    // 每帧都隐藏手雷模型：切换投掷物种类等操作可能把它重新设为可见。
    if(asset)Object.values(asset.models||{}).forEach(value=>value.root.visible=false);
    const fallbackParts=grenadeThrowView.userData;if(fallbackParts.grenade)fallbackParts.grenade.visible=false;if(fallbackParts.ring)fallbackParts.ring.visible=false;if(fallbackParts.leftArm)fallbackParts.leftArm.visible=false;
    knifeView.visible=true;
    const elapsed=knifeSwingStartedAt?performance.now()-knifeSwingStartedAt:Infinity;if(elapsed>=KNIFE_SWING_MS){knifeSwingStartedAt=0;return;}
    // 轻击：先向右上蓄力，再斜向左下划过准星，最后回到持刀姿势。
    const t=elapsed/KNIFE_SWING_MS,smooth=value=>{const x=THREE.MathUtils.clamp(value,0,1);return x*x*(3-2*x);};
    const windup=smooth(t/KNIFE_STRIKE_START),strike=smooth((t-KNIFE_STRIKE_START)/(KNIFE_STRIKE_END-KNIFE_STRIKE_START)),recover=smooth((t-KNIFE_STRIKE_END)/(1-KNIFE_STRIKE_END)),hold=1-recover;
    const px=(.05*windup+(-.21)*strike)*hold,py=(.045*windup+(-.1)*strike)*hold,pz=(.02*windup+(-.1)*strike)*hold;
    const ry=(.28*windup+(-.85)*strike)*hold,rz=(-.3*windup+.75*strike)*hold,rx=(.08*windup+(-.32)*strike)*hold;
    grenadeThrowView.position.x+=px;grenadeThrowView.position.y+=py;grenadeThrowView.position.z+=pz;grenadeThrowView.rotation.x+=rx;grenadeThrowView.rotation.y+=ry;grenadeThrowView.rotation.z+=rz;
  }
  function playMeleeWhoosh(position,volume=.26){const context=ensureAudio();if(!context||!sfxBus||!gunNoiseBuffer)return;if(context.state==='suspended')context.resume();const now=context.currentTime,distance=position?position.distanceTo(camera.position):0,gain=context.createGain(),filter=context.createBiquadFilter(),noise=context.createBufferSource();filter.type='bandpass';filter.Q.value=1.4;filter.frequency.setValueAtTime(2400,now);filter.frequency.exponentialRampToValueAtTime(520,now+.2);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume/(1+distance*.25)),now+.05);gain.gain.exponentialRampToValueAtTime(.0001,now+.22);noise.buffer=gunNoiseBuffer;noise.playbackRate.value=.55;noise.connect(filter);filter.connect(gain);gain.connect(sfxBus);noise.start(now);noise.stop(now+.24);}
  function playMeleeImpact(surface){const context=ensureAudio();if(!context||!sfxBus)return;if(context.state==='suspended')context.resume();const now=context.currentTime,osc=context.createOscillator(),gain=context.createGain();osc.type=surface==='metal'?'square':'triangle';osc.frequency.setValueAtTime(surface==='metal'?1900:620,now);osc.frequency.exponentialRampToValueAtTime(surface==='metal'?900:180,now+.09);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.09,now+.006);gain.gain.exponentialRampToValueAtTime(.0001,now+.12);osc.connect(gain);gain.connect(sfxBus);osc.start(now);osc.stop(now+.13);}
  function meleeAttack(){
    const config=WEAPONS[weapon],now=Date.now(),lastShot=lastLocalShotByWeapon.get(weapon)||0;
    if(!playing||dead||spectating||matchFinished||(currentMatch.phase!=='WARMUP'&&currentMatch.phase!=='PLAYING')||localWeaponBusy())return false;
    if(now-lastShot<(config.cooldown||420))return false;lastLocalShotByWeapon.set(weapon,now);
    knifeSwingStartedAt=performance.now();playMeleeWhoosh(null);
    send({type:'shoot',shotId:++shotSequence,aimYaw:state.yaw,aimPitch:THREE.MathUtils.clamp(state.pitch,-1.45,1.45)});
    return true;
  }
  function poseGrenadeHands(asset,pull,drive){
    // AK/M4 的节点手臂具有更厚的袖管和独立手掌，不套用细手臂的骨骼卷曲值。
    // 右手负责投掷；左手只在拉环阶段短暂入镜，完成后立即退出视野。
    if(asset.armRig==='NODE_HANDS'){
      if(asset.leftUpper&&asset.leftBase){
        const reach=THREE.MathUtils.smoothstep(pull,.08,.72)*(1-THREE.MathUtils.smoothstep(pull,.78,1));
        asset.leftUpper.visible=reach>.015;
        asset.leftUpper.position.copy(asset.leftBase.position).add(_poseOffset.set(.18*reach,.48*reach,-.16*reach));
        asset.leftUpper.quaternion.copy(asset.leftBase.quaternion).multiply(_poseQuat.setFromEuler(_poseEuler.set(-.12*reach,.18*reach,-.28*reach)));
      }
      return;
    }
    const boneCache=asset.poseBoneCache||(asset.poseBoneCache={}),setBone=(name,x,y,z)=>{let bone=boneCache[name];if(bone===undefined)bone=boneCache[name]=asset.arms?.getObjectByName(name)||null;const base=asset.poseBases?.[name];if(bone&&base)bone.quaternion.copy(base).multiply(_poseQuat.setFromEuler(_poseEuler.set(x,y,z)));};
    const rightCurl=1.14+drive*.26,leftReach=.22+pull*.38;
    // Palms face each other for a believable grenade grip: right hand drives the throw,
    // left hand only reaches in to pull the pin. Thumbs stay rolled upward.
    setBone('HandR001',.14,-.08,-1.48-drive*.06);setBone('IndexR001',rightCurl,0,.16);setBone('DoubleFingersR001',rightCurl*.98,0,.12);setBone('ThumbR001',.52,0,-.22);
    setBone('HandL',.08,.18,1.42+pull*.06);setBone('IndexL',leftReach,0,-.10);setBone('DoubleFingersL',leftReach*.92,0,-.06);setBone('ThumbL',.32+pull*.14,0,.28);
  }
  function updateGrenadeThrowView(action,progress,commitProgress){
    const serverThrowing=action==='THROWING_GRENADE',holding=throwableEquipped&&!serverThrowing,quickAiming=holding&&!CLASSIC_THROW_MODE&&grenadePriming,active=serverThrowing||holding;
    grenadeThrowView.visible=active&&!quickAiming&&(holding||progress<.98);if(!active||quickAiming)return;
    const heldPrime=holding&&grenadePriming?THREE.MathUtils.clamp((performance.now()-grenadePrimeStartedAt)/260,0,1):0;
    const visualProgress=serverThrowing?progress:0;
    const smooth=value=>value*value*(3-2*value),raise=holding?0:smooth(THREE.MathUtils.clamp(visualProgress/(CLASSIC_THROW_MODE?.22:.12),0,1)),pull=holding?smooth(heldPrime):smooth(THREE.MathUtils.clamp((visualProgress-(CLASSIC_THROW_MODE?.18:.05))/(CLASSIC_THROW_MODE?.2:.11),0,1)),throwForward=smooth(THREE.MathUtils.clamp((visualProgress-(CLASSIC_THROW_MODE?.28:.12))/(CLASSIC_THROW_MODE?.18:.20),0,1)),throwRecover=1-smooth(THREE.MathUtils.clamp((visualProgress-(CLASSIC_THROW_MODE?.58:.48))/(CLASSIC_THROW_MODE?.32:.27),0,1)),drive=serverThrowing?throwForward*throwRecover:0;
    const basePosition=grenadeViewLayout.viewPosition,baseRotation=grenadeViewLayout.viewRotation;grenadeThrowView.position.set(basePosition[0],basePosition[1]+raise*.08,basePosition[2]);grenadeThrowView.rotation.fromArray(baseRotation);
    const asset=grenadeThrowView.userData.asset;
    if(asset){
      const pinOffset=grenadeViewLayout.pinPullOffset;asset.grenade.visible=holding||progress<commitProgress;if(asset.pin){asset.pin.visible=holding||progress<commitProgress;asset.pin.position.set(asset.pinBase.x+pull*pinOffset[0],asset.pinBase.y+pull*pinOffset[1],asset.pinBase.z+pull*pinOffset[2]);}
      // Keep the arm container fixed during the throw. Rotating this parent made
      // the left forearm appear to throw as well; only RightArmPivot is animated.
      // The runtime must use the exact same zero-frame transform as the studio.
      // Throw motion belongs to the outer view/root and arm pivots; a hidden
      // runtime-only root offset made saved model positions appear ineffective.
      asset.root.position.set(0,0,0);asset.root.rotation.fromArray(grenadeViewLayout.axisRotation);
      if(asset.armRig==='ANIMATED_SKINNED'&&asset.throwAction&&asset.throwClip){
        const animationProgress=serverThrowing?visualProgress:(grenadePriming?heldPrime*.40:0);asset.throwAction.time=asset.throwClip.duration*THREE.MathUtils.clamp(animationProgress,0,1);asset.mixer.update(0);
      }else{
        if(asset.rightUpper)asset.rightUpper.visible=true;
        if(asset.leftUpper&&asset.leftBase){asset.leftUpper.position.copy(asset.leftBase.position);asset.leftUpper.quaternion.copy(asset.leftBase.quaternion);if(asset.armRig==='STATIC_PIVOTS'){
          // 当前静态烘焙手臂没有足够的关节自由度来表现细小的拔销动作。
          // 暂时完全隐藏左臂，只让右手持雷和投掷，避免左手的大幅前送被误读为投掷。
          asset.leftUpper.visible=false;
        }else asset.leftUpper.position.y-=8;}
        if(asset.rightUpper&&asset.rightBase){
          // 右手是唯一执行前送投掷的手。使用小角度旋转配合向前位移，避免将整条
          // 静态前臂横扫进镜头；手雷提交后仍保留一小段自然的随挥动作。
          // Drive mostly along view-forward without changing the calibrated side axis.
          asset.rightUpper.position.copy(asset.rightBase.position).add(new THREE.Vector3(0,.045*drive,-.2*drive));
          // +0.18 is the calibrated grip basis shared by the hand mesh and its
          // RightHandMount. Keep it constant and remove only the old cross-body
          // sweep; changing its sign makes M84/M18 project away from the palm.
          asset.rightUpper.quaternion.copy(asset.rightBase.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,.18)));
        }
        poseGrenadeHands(asset,pull,drive);
      }
      return;
    }
    const {grenade,ring,rightArm,leftArm}=grenadeThrowView.userData;grenade.visible=holding||progress<commitProgress;grenade.rotation.set(drive*2.4,0,-drive*.7);ring.visible=holding||progress<commitProgress;ring.position.set(-.075-pull*.14,.155+pull*.035,0);
    rightArm.position.set(.21,-.18+raise*.055,.08);rightArm.rotation.set(-drive*.24,0,-.12-drive*.22);
    leftArm.visible=progress<.62;leftArm.position.set(-.35+pull*.32,-.2+pull*.16,.08-drive*.1);leftArm.rotation.set(0,0,.12-pull*.18);
  }
  function updateHud() {
    if (!me) return;
    $('hp').style.width = me.hp + '%'; $('hpText').textContent = me.hp; $('armor').style.width = me.armor + '%'; $('armorText').textContent = me.armor;
    const onboardingVisible=!$('buffSelection').classList.contains('hidden');
    $('protectHint').classList.toggle('hidden',onboardingVisible||Date.now()>=(me.invulnerableUntil||0));
    const buffNames={NO_AMMO:'出生增益：没有子弹',LEFT_TRAJECTORY:'出生增益：弹道偏左',FEARLESS:'出生增益：无所畏惧'};
    const buffActive=!!me.spawnBuffActive&&buffNames[me.spawnBuff],buffSeconds=Math.max(0,((me.spawnBuffUntil||0)-Date.now())/1000),speedActive=!!me.speedBoostActive,speedSeconds=Math.max(0,((me.speedBoostUntil||0)-Date.now())/1000),invisibleActive=!!me.invisibleActive,invisibleSeconds=Math.max(0,((me.invisibleUntil||0)-Date.now())/1000),buffText=[buffActive?`${buffNames[me.spawnBuff]} · ${buffSeconds.toFixed(1)}s`:'',speedActive?`动力增幅：移速 +20% · 跳跃强化 · ${speedSeconds.toFixed(1)}s`:'',invisibleActive?`光学隐身 · ${invisibleSeconds.toFixed(1)}s`:'' ].filter(Boolean).join('  |  ');$('buffHint').textContent=buffText;$('buffHint').classList.toggle('hidden',!buffText);
    const waitingPickup=!dead&&!spectating?worldItems.filter(item=>!item.available&&item.respawnRemainingMs>0).sort((a,b)=>Math.hypot(state.x-a.x,state.z-a.z)-Math.hypot(state.x-b.x,state.z-b.z))[0]:null;
    const pickupDistance=waitingPickup?Math.hypot(state.x-waitingPickup.x,state.z-waitingPickup.z):Infinity,pickupRespawn=$('pickupRespawnHint');
    if(waitingPickup&&pickupDistance<4.5){pickupRespawn.textContent=`${SUPPLY_META[waitingPickup.itemType]?.name||WEAPONS[waitingPickup.weapon]?.name||'补给'} 刷新 ${(waitingPickup.respawnRemainingMs/1000).toFixed(1)}s`;pickupRespawn.classList.remove('hidden');}else pickupRespawn.classList.add('hidden');
    const remaining = Math.max(0, (me.reloadUntil || 0) - Date.now()), duration = WEAPONS[weapon].reload;
    $('reload').style.width = remaining ? ((1 - remaining / duration) * 100) + '%' : '0';
    if (me.alive && dead) { dead = false; $('death').classList.add('hidden'); }
  }
  function updateNetworkStatus(){
    const node=$('networkStatus');if(!node)return;
    node.querySelector('span').textContent=pingMs?`${pingMs} ms`:'-- ms';
    node.classList.toggle('warn',pingMs>=60&&pingMs<120);node.classList.toggle('bad',pingMs>=120);
  }
  function publishPerformanceSnapshot(stalls){
    const render=renderer.info.render,memory=renderer.info.memory,heap=performance.memory;
    const snapshot={timestamp:Date.now(),roomId:selectedRoomId,playing,measurementReady:performance.now()>=performanceGraceUntil,quality:qualityName,graphics:graphicsInfo,fps:measuredFps,onePercentLow,p99FrameMs:Number(p99FrameMs.toFixed(2)),stalls,
      longTasks:longTaskCount,longTaskMs:Number(longTaskMs.toFixed(2)),corrections:correctionCount,correctionMeters:Number(correctionDistance.toFixed(3)),pingMs,maxSnapshotGapMs:Number(maxSnapshotGapMs.toFixed(1)),deathReconciliations:deathReconciliationCount,
      render:{calls:render.calls,triangles:render.triangles,lines:render.lines,points:render.points,geometries:memory.geometries,textures:memory.textures},
      heap:heap?{usedMiB:Number((heap.usedJSHeapSize/1048576).toFixed(1)),totalMiB:Number((heap.totalJSHeapSize/1048576).toFixed(1)),limitMiB:Number((heap.jsHeapSizeLimit/1048576).toFixed(0))}:null,
      assetTimings:{...assetTimings}};
    globalThis.__ZERO_PERFORMANCE__=snapshot;dispatchEvent(new CustomEvent('zero-performance',{detail:snapshot}));longTaskCount=0;longTaskMs=0;maxSnapshotGapMs=0;
  }

  function currentInput(jump) {
    return {forward:(keys.KeyW?1:0)-(keys.KeyS?1:0),right:(keys.KeyD?1:0)-(keys.KeyA?1:0),sprint:!!keys.ShiftLeft,jump,yaw:state.yaw+aimRecoilYaw,pitch:state.pitch+aimRecoilPitch};
  }

  /** 与服务端 updateMovement 使用相同参数，供本地预测和未确认输入重放。 */
  function simulateMovement(target, input, dt) {
    let forward=input.forward,right=input.right,length=Math.hypot(forward,right);
    if(length>1){forward/=length;right/=length;}
    const equipmentMultiplier=throwableEquipped?1.06:(WEAPONS[weapon]?.movementMultiplier??1);
    const speed=(input.sprint?9:6)*equipmentMultiplier*(me?.spawnBuff==='FEARLESS'&&me?.spawnBuffActive?1.25:1)*(me?.speedBoostActive?1.20:1);
    const dx=(-Math.sin(input.yaw)*forward+Math.cos(input.yaw)*right)*speed*dt;
    const dz=(-Math.cos(input.yaw)*forward-Math.sin(input.yaw)*right)*speed*dt;
    const startFeetY=target.y-MAP_PHYSICS.settings.eyeHeight;
    const moved=MAP_PHYSICS.moveHorizontal({x:target.x,z:target.z,feetY:startFeetY},dx,dz,target.onGround);
    target.x=moved.x;target.z=moved.z;
    if(target.onGround)target.y=moved.feetY+MAP_PHYSICS.settings.eyeHeight;
    if(input.jump&&target.onGround){target.vy=me?.speedBoostActive?11.25:8;target.onGround=false;}
    target.vy-=20*dt;
    const vertical=MAP_PHYSICS.resolveVertical(target.x,target.z,target.y,target.vy,dt);
    target.y=vertical.eyeY;target.vy=vertical.verticalVelocity;target.onGround=vertical.onGround;
  }

  function spectatorCandidates(){return latestPlayers.filter(player=>player.alive);}
  function selectSpectatorTarget(direction=1){
    const candidates=spectatorCandidates();if(!candidates.length){spectatorTargetId=null;spectatorMode='FREE';syncSpectatorHud();return;}
    const current=candidates.findIndex(player=>player.id===spectatorTargetId);
    spectatorTargetId=candidates[(current+direction+candidates.length)%candidates.length].id;spectatorMode='FOLLOW';syncSpectatorHud();
  }
  function syncSpectatorHud(){
    const target=latestPlayers.find(player=>player.id===spectatorTargetId);
    if(spectatorMode==='FOLLOW'&&!target){const candidates=spectatorCandidates();spectatorTargetId=candidates[0]?.id||null;if(!spectatorTargetId)spectatorMode='FREE';}
    const active=latestPlayers.find(player=>player.id===spectatorTargetId);
    $('spectatorTarget').textContent=spectatorMode==='FOLLOW'&&active?active.name:'自由视角';
    $('spectatorMode').textContent=spectatorMode==='FOLLOW'?'◉':'◎';
  }
  function setSpectatorMode(mode){
    spectatorMode=mode;if(mode==='FOLLOW'&&!spectatorTargetId){selectSpectatorTarget(1);return;}
    if(mode==='FREE'){state.x=camera.position.x;state.y=camera.position.y;state.z=camera.position.z;}
    syncSpectatorHud();
  }
  /**
   * 自由观战相机只存在于客户端，不向服务端发送位置。跟随模式直接使用最新权威快照，
   * 因此观战工具不会污染战斗玩家的预测历史，也不会占用房间移动计算预算。
   */
  function updateSpectatorCamera(dt){
    if(spectatorMode==='FOLLOW'){
      const target=latestPlayers.find(player=>player.id===spectatorTargetId&&player.alive);
      if(!target){selectSpectatorTarget(1);return;}
      camera.position.set(target.x,target.y,target.z);camera.rotation.order='YXZ';camera.rotation.set(target.pitch||0,target.yaw||0,0);syncSpectatorHud();return;
    }
    let forward=(keys.KeyW?1:0)-(keys.KeyS?1:0),right=(keys.KeyD?1:0)-(keys.KeyA?1:0),vertical=(keys.Space?1:0)-(keys.ControlLeft||keys.ControlRight?1:0),length=Math.hypot(forward,right,vertical);if(length>1){forward/=length;right/=length;vertical/=length;}
    const speed=(keys.ShiftLeft?24:12)*dt,cos=Math.cos(state.yaw),sin=Math.sin(state.yaw);state.x+=(-sin*forward+cos*right)*speed;state.z+=(-cos*forward-sin*right)*speed;state.y=THREE.MathUtils.clamp(state.y+vertical*speed,1,45);state.x=THREE.MathUtils.clamp(state.x,-80,80);state.z=THREE.MathUtils.clamp(state.z,-80,80);camera.position.set(state.x,state.y,state.z);camera.rotation.order='YXZ';camera.rotation.set(state.pitch,state.yaw,0);
  }

  let footstepCooldown=0;
  function updateFootsteps(dt){
    if(!playing||dead||spectating||!state.onGround||settingsOpen)return;
    const moving=keys.KeyW||keys.KeyA||keys.KeyS||keys.KeyD;
    if(!moving){footstepCooldown=0;return;}
    footstepCooldown-=dt;
    if(footstepCooldown>0)return;
    const sprint=!!keys.ShiftLeft;
    footstepCooldown=sprint?.24:.34;
    playFootstepSound(sprint);
  }
  function tick(dt) {
    if (!playing || settingsOpen || matchFinished) return;
    // 观战相机不参与服务端战斗，热身阶段也必须允许自由观察地图；只有战斗玩家
    // 的预测、输入发送和拾取需要等待 PLAYING。
    if(spectating){updateSpectatorCamera(dt);return;}
    if(currentMatch.phase!=='WARMUP'&&currentMatch.phase!=='PLAYING')return;
    if(dead)return;
    simulateMovement(state,currentInput(jumpRequested),dt);
    updateFootsteps(dt);
    inputAccumulator+=dt;
    while(inputAccumulator>=INPUT_INTERVAL){
      const input={type:'input',sequence:++inputSequence,...currentInput(jumpRequested)};
      pendingInputs.push(input);if(pendingInputs.length>120)pendingInputs.shift();send(input);
      jumpRequested=false;inputAccumulator-=INPUT_INTERVAL;
    }
    // Settle a visible correction in roughly 100-150 ms so it cannot bleed into
    // the following server snapshot and create a repeated slow-motion sensation.
    renderCorrection.multiplyScalar(Math.pow(.00001,dt));
    camera.position.set(state.x+renderCorrection.x,state.y+renderCorrection.y,state.z+renderCorrection.z);camera.rotation.order='YXZ';camera.rotation.set(state.pitch+aimRecoilPitch,state.yaw+aimRecoilYaw,0);
  }
  function canPickupWorldItem(item){if(item.itemType==='WEAPON')return !ownedWeapons.has(item.weapon);if(item.itemType==='MEDKIT_SMALL')return (me?.hp||0)<100;if(item.itemType==='ARMOR_VEST')return (me?.armor||0)<50;if(item.itemType==='AMMO_BOX')return (me?.reserveAmmo??0)<(WEAPONS[weapon]?.defaultReserve??0);if(item.itemType==='THROWABLE_FRAG')return throwableCount('frag_grenade')<2;if(item.itemType==='THROWABLE_FLASH')return throwableCount('flash_grenade')<2;if(item.itemType==='THROWABLE_SMOKE')return throwableCount('smoke_grenade')<2;return true;}
  function tryPickup(){if(!playing||dead||spectating||matchFinished||(currentMatch.phase!=='WARMUP'&&currentMatch.phase!=='PLAYING')||!$('buffSelection').classList.contains('hidden'))return;const now=Date.now();if(now-lastPickupAttempt<500)return;const item=worldItems.find(value=>value.available&&canPickupWorldItem(value)&&Math.hypot(state.x-value.x,state.z-value.z)<2.2);if(item){lastPickupAttempt=now;send({type:'pickup',itemId:item.id});}}
  function localWeaponBusy(){const now=Date.now();return(localGrenadeThrowStartedAt>0&&now<localGrenadeThrowStartedAt+THROW_DURATION_MS)||(me?.weaponAction&&me.weaponAction!=='READY'&&now<(me.weaponActionUntil||0));}
  function throwableCount(type=selectedThrowable){return Number(throwableInventory[type])||0;}
  function nextThrowable(){const types=Object.keys(THROWABLES),start=Math.max(0,types.indexOf(selectedThrowable));for(let offset=1;offset<=types.length;offset++){const type=types[(start+offset)%types.length];if(throwableCount(type)>0){selectedThrowable=type;activateThrowableAsset(type);renderLoadout(me||{});showWeaponState(`已选择 ${THROWABLES[type].name}`);return true;}}return false;}
  function syncCrosshairVisibility(){const isSniper=WEAPONS[weapon]?.category==='SNIPER_RIFLE',quickThrowableHidden=throwableEquipped&&!CLASSIC_THROW_MODE&&!grenadePriming;$('crosshair').classList.toggle('hidden',spectating||quickThrowableHidden||(isSniper&&!throwableEquipped));}
  function unequipThrowable(){if(throwableEquipped)send({type:'unequip_throwable'});throwableEquipped=false;grenadePriming=false;grenadePrimeStartedAt=0;syncCrosshairVisibility();}
  function equipThrowable(){if(!playing||dead||spectating||matchFinished||(currentMatch.phase!=='WARMUP'&&currentMatch.phase!=='PLAYING')||localWeaponBusy())return;if(throwableEquipped){if(!grenadePriming)nextThrowable();return;}if(throwableCount()<=0&&!nextThrowable()){showWeaponState('没有可用投掷物');return;}scope(false);firing=false;throwableEquipped=true;send({type:'equip_throwable'});grenadePriming=false;grenadePrimeStartedAt=0;activateThrowableAsset(selectedThrowable);renderLoadout(me||{});syncCrosshairVisibility();showWeaponState(`${THROWABLES[selectedThrowable].name} 已装备，再按 4 切换类型`);}
  function startGrenadePrime(){if(!throwableEquipped||grenadePriming||!playing||dead||spectating||matchFinished||(currentMatch.phase!=='WARMUP'&&currentMatch.phase!=='PLAYING')||throwableCount()<=0||localWeaponBusy())return;grenadePriming=true;grenadePrimeStartedAt=performance.now();playGrenadePinSound();syncCrosshairVisibility();showWeaponState(CLASSIC_THROW_MODE?'松开左键投掷':'松开左键快速投掷');}
  function releaseGrenadePrime(){if(!grenadePriming)return;grenadePriming=false;syncCrosshairVisibility();throwGrenade();}
  function shoot() {
    if(throwableEquipped){startGrenadePrime();return false;}
    if(WEAPONS[weapon]?.category==='MELEE')return meleeAttack();
    const config=WEAPONS[weapon],now=Date.now(),lastShot=lastLocalShotByWeapon.get(weapon)||0,remaining=config.cooldown-(now-lastShot);if(!playing||dead||spectating||matchFinished||(currentMatch.phase!=='WARMUP'&&currentMatch.phase!=='PLAYING')||ammo<=0||now<(me?.reloadUntil||0)||localWeaponBusy())return false;if(remaining>0){if(config.category==='SNIPER_RIFLE')showWeaponState(`拉栓中 ${(remaining/1000).toFixed(1)}s`);return false;}lastLocalShotByWeapon.set(weapon,now);
    const heat=weaponHeat.get(weapon)||0,moving=keys.KeyW||keys.KeyS||keys.KeyA||keys.KeyD;
    // 浏览器只提交开火瞬间的瞄准意图。最终圆盘散布、移动惩罚和实际射线方向由
    // Java 服务端生成；本地 heat 只驱动准心动画，不再参与可信命中判定。
    const shotId=++shotSequence,aimYaw=state.yaw+aimRecoilYaw,aimPitch=THREE.MathUtils.clamp(state.pitch+aimRecoilPitch,-1.45,1.45);
    weaponHeat.set(weapon,Math.min(config.maxBloom||0,heat+(config.bloomPerShot||0)));
    // M4 偏稳定、快速回正；AK 上跳和水平摆动更明显，以高伤害交换操控难度。
    const cameraKick=config.verticalRecoil??.006;
    const horizontalKick=(config.horizontalRecoil??cameraKick*.3)*(1+heat*.42);
    aimRecoilPitch=Math.min(.24,aimRecoilPitch+cameraKick*(.72+Math.random()*.45));
    aimRecoilYaw=THREE.MathUtils.clamp(aimRecoilYaw+(Math.random()-.5)*horizontalKick,-.09,.09);
    spreadKick=Math.min(22,spreadKick+config.kick);
    triggerFireView();send({type:'shoot',shotId,aimYaw,aimPitch});
    if(config.category==='SNIPER_RIFLE')setTimeout(()=>{if(playing&&!dead&&weapon==='sniper')playBoltSound('sniper');},620);
    if(config.category==='SNIPER_RIFLE'&&!config.retainScopeAfterShot)scope(false);
    return true;
  }
  function throwGrenade(){const now=performance.now(),type=selectedThrowable;if(!playing||dead||spectating||matchFinished||(currentMatch.phase!=='WARMUP'&&currentMatch.phase!=='PLAYING')||throwableCount(type)<=0||localWeaponBusy()||now-lastGrenadeThrowAt<700)return;lastGrenadeThrowAt=now;localGrenadeThrowStartedAt=Date.now();scope(false);throwableEquipped=false;grenadePriming=false;grenadePrimeStartedAt=0;syncCrosshairVisibility();send({type:'throw_grenade',throwable:type,aimYaw:state.yaw,aimPitch:state.pitch,throwStyle:THROWABLE_INPUT_MODE});showWeaponState(`投掷${THROWABLES[type].name}`);}
  /**
   * 权威射线仍从玩家视线发出，但曳光弹属于视觉表现，必须从枪口飞向权威终点。
   * 第一人称枪口先从 ViewModel 相机空间映射到世界相机；远端玩家则读取 WorldModel
   * 挂点。任一资源尚未就绪时才回退到服务端眼睛坐标，避免射击消息被丢弃。
   */
  function tracerStart(data){
    if(data.id===id&&!spectating){
      const muzzle=weaponViews[data.weapon]?.userData.muzzle;if(muzzle){
        viewModelScene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
        const point=new THREE.Vector3();muzzle.getWorldPosition(point);
        viewModelCamera.worldToLocal(point);return camera.localToWorld(point);
      }
    }
    const remoteMuzzle=remote.get(data.id)?.userData.remoteMuzzle;
    if(remoteMuzzle){remoteMuzzle.updateMatrixWorld(true);return remoteMuzzle.getWorldPosition(new THREE.Vector3());}
    return new THREE.Vector3(data.ox,data.oy,data.oz);
  }
  const tracerPool=[],_tracerFrom=new THREE.Vector3(),_tracerTo=new THREE.Vector3();
  function acquireTracer(){const pooled=tracerPool.pop();if(pooled)return pooled;const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));line.frustumCulled=false;return {line,start:new THREE.Vector3(),end:new THREE.Vector3(),born:0,duration:0,segmentLength:1.35};}
  function tracer(data){
    const authorityStart=new THREE.Vector3(data.ox,data.oy,data.oz),direction=new THREE.Vector3(data.dx,data.dy,data.dz).normalize();
    const end=Array.isArray(data.hitPoint)?new THREE.Vector3().fromArray(data.hitPoint):authorityStart.clone().addScaledVector(direction,data.distance||45);
    const start=tracerStart(data),record=acquireTracer();record.line.material.color.setHex(data.weapon==='ak47'?0xffd36a:0x78eaff);record.line.material.opacity=.9;record.start.copy(start);record.end.copy(end);record.born=performance.now();record.duration=THREE.MathUtils.clamp(start.distanceTo(end)*1.2,34,80);record.segmentLength=1.35;
    scene.add(record.line);visualTracers.push(record);
    if(data.impact==='wall'){if(Array.isArray(data.hitPoint)&&Array.isArray(data.normal))placeBulletHole(end,new THREE.Vector3().fromArray(data.normal).normalize(),data.surface||'concrete');else createBulletHole(authorityStart,direction,data.distance||45);}
  }
  function updateVisualTracers(now){
    for(let index=visualTracers.length-1;index>=0;index--){
      const tracer=visualTracers[index],progress=(now-tracer.born)/tracer.duration;
      if(progress>=1){scene.remove(tracer.line);if(tracerPool.length<64)tracerPool.push(tracer);else{tracer.line.geometry.dispose();tracer.line.material.dispose();}visualTracers[index]=visualTracers[visualTracers.length-1];visualTracers.pop();continue;}
      const distance=tracer.start.distanceTo(tracer.end),head=Math.min(1,progress+.18),tail=Math.max(0,head-tracer.segmentLength/Math.max(distance,.001));
      const from=_tracerFrom.copy(tracer.start).lerp(tracer.end,tail),to=_tracerTo.copy(tracer.start).lerp(tracer.end,head),array=tracer.line.geometry.attributes.position.array;
      array[0]=from.x;array[1]=from.y;array[2]=from.z;array[3]=to.x;array[4]=to.y;array[5]=to.z;tracer.line.geometry.attributes.position.needsUpdate=true;tracer.line.material.opacity=.9*(1-progress);
    }
  }
  /** 旧协议没有权威命中点时才回退到客户端 Raycaster。 */
  function createBulletHole(start,direction,distance){const ray=new THREE.Raycaster(start,direction,0,Math.min(distance+.15,50)),hit=ray.intersectObjects(obstacleMeshes,false)[0];if(!hit||!hit.face)return;const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld),surface=hit.object.userData.surfaceType||'concrete';placeBulletHole(hit.point,normal,surface);}
  const bulletHoleAssets={};
  function placeBulletHole(point,normal,surface){
    // 使用不透明贴花进入 opaque 渲染队列，确保第一人称枪械最后绘制时能正确遮住弹痕。
    const style=surface==='metal'?{color:0x111827,size:.055,segments:8}:{color:0x181614,size:.085,segments:12};
    const styleKey=surface==='metal'?'metal':'default';let holeAsset=bulletHoleAssets[styleKey];if(!holeAsset)holeAsset=bulletHoleAssets[styleKey]={geometry:new THREE.CircleGeometry(style.size,style.segments),material:new THREE.MeshBasicMaterial({color:style.color,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4})};const hole=new THREE.Mesh(holeAsset.geometry,holeAsset.material);hole.position.copy(point).addScaledVector(normal,.008);hole.quaternion.setFromUnitVectors(_fxUp,normal);scene.add(hole);spawnImpactParticles(point,normal,surface);bulletHoles.push(hole);if(bulletHoles.length>100){const old=bulletHoles.shift();scene.remove(old);}setTimeout(()=>{const index=bulletHoles.indexOf(hole);if(index>=0){bulletHoles.splice(index,1);scene.remove(hole);}},12000);}
  function spawnImpactParticles(point,normal,surface){const count=surface==='metal'?7:5,color=surface==='metal'?0xffc45a:0x9aa5b2;for(let i=0;i<count&&visualParticles.length<quality.particles;i++){const metal=surface==='metal',particle=acquireFxMesh(metal?'impact-metal':'impact-concrete',()=>new THREE.OctahedronGeometry(metal?.018:.025,0),()=>new THREE.MeshBasicMaterial({color}));particle.position.copy(point).addScaledVector(normal,.025);_fxVelocity.set(Math.random()-.5,Math.random()*.7,Math.random()-.5).addScaledVector(normal,.8+Math.random()*1.5);scene.add(particle);pushFxParticle(particle,scene,.22+Math.random()*.24,.46,{velocity:_fxVelocity,gravity:metal?5:2});}}
  /** 弹壳属于第一人称表现层；服务端只关心这一发子弹是否有效，不同步装饰粒子。 */
  function spawnCasing(view){
    const port=view.userData.ejectionPort;if(!port||visualParticles.length>=quality.particles)return;
    const config=view.userData.assetConfig?.effects?.casing||{},base=config.baseVelocity||[.75,.55,.15],random=config.randomVelocity||[.45,.35,.25];
    port.updateMatrixWorld(true);const origin=port.getWorldPosition(_fxCasingOrigin);
    const radius=config.radius||.012,length=config.length||.055,casingColor=config.color||0xd6a741,casing=acquireFxMesh(`casing-${radius}-${length}-${casingColor}`,()=>new THREE.CylinderGeometry(radius,radius,length,7),()=>new THREE.MeshStandardMaterial({color:casingColor,metalness:.82,roughness:.28}));
    casing.position.copy(origin);casing.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.PI/2);viewModelScene.add(casing);
    pushFxParticle(casing,viewModelScene,.65,.65,{velocity:_fxVelocity.set(base[0]+Math.random()*random[0],base[1]+Math.random()*random[1],base[2]+Math.random()*random[2]),gravity:config.gravity||2.4,angular:_fxAngular.set(12+Math.random()*8,8+Math.random()*7,10+Math.random()*8)});
    if(libraryAudioBuffers['shells-ground.ogg']&&Math.random()<.72){const casingVolume=weaponAudioConfig().casingVolume??.3;setTimeout(()=>playLibrarySound('shells-ground.ogg',null,casingVolume),180+Math.random()*170);}
  }
  function updateVisualParticles(dt){for(let i=visualParticles.length-1;i>=0;i--){const particle=visualParticles[i],object=particle.object;particle.life-=dt;
    // 粒子是纯表现层；数据不完整时立即回收，绝不能让异常中断移动和重力所在的主循环。
    if(particle.life<=0||!particle.velocity){releaseFxMesh(object,particle.container||scene);visualParticles[i]=visualParticles[visualParticles.length-1];visualParticles.pop();continue;}object.position.addScaledVector(particle.velocity,dt);if(particle.gravity)particle.velocity.y-=particle.gravity*dt;if(particle.angularVelocity){object.rotation.x+=particle.angularVelocity.x*dt;object.rotation.y+=particle.angularVelocity.y*dt;object.rotation.z+=particle.angularVelocity.z*dt;}const ratio=particle.life/particle.maxLife;if(particle.smoke){object.material.opacity=Math.max(0,ratio*.32);object.scale.multiplyScalar(1+dt*2.5);}else{if(particle.spark)object.material.opacity=Math.max(0,ratio);object.scale.setScalar(Math.max(.15,ratio));}}}
  function reload(){if(throwableEquipped)return;if(!me||ammo===WEAPONS[weapon].mag||reserveAmmo===0||Date.now()<(me.reloadUntil||0)||localWeaponBusy())return;send({type:'reload'});}
  function setWeapon(next){if(!WEAPONS[next]||(weapon===next&&!throwableEquipped)||localWeaponBusy()||grenadePriming)return;if(!ownedWeapons.has(next)){chat(`地图中可以拾取 ${WEAPONS[next].name}`,true);return;}unequipThrowable();scope(false);send({type:'switch_weapon',weapon:next});if(libraryAudioBuffers['switch-weapon.ogg'])playLibrarySound('switch-weapon.ogg',camera.position,weaponAudioConfig(next).switchVolume??.85);spreadKick=0;}
  function scope(on){const isSniper=WEAPONS[weapon].category==='SNIPER_RIFLE';const next=!!on&&isSniper&&playing&&!dead&&!matchFinished&&!localWeaponBusy();if(next&&!scoped&&libraryAudioBuffers['sniper-scope-zoom-in.ogg'])playLibrarySound('sniper-scope-zoom-in.ogg',camera.position,weaponAudioConfig().scopeVolume??.78);if(next!==scoped)send({type:'scope',active:next});scoped=next;aimTarget=next?1:0;syncCrosshairVisibility();}
  function serverLikeAimCandidate(){
    if(!latestPlayers.length||!me)return false;
    const origin=new THREE.Vector3(state.x,state.y,state.z),cos=Math.cos(state.pitch);
    const direction=new THREE.Vector3(-Math.sin(state.yaw)*cos,Math.sin(state.pitch),-Math.cos(state.yaw)*cos).normalize();
    let best=Infinity;
    for(const player of latestPlayers){
      if(player.id===id||player.spectator||!player.alive)continue;
      const tx=player.x-origin.x,ty=(player.y-.7)-origin.y,tz=player.z-origin.z,t=tx*direction.x+ty*direction.y+tz*direction.z;
      if(t<=0||t>=best)continue;
      const px=tx-direction.x*t,py=ty-direction.y*t,pz=tz-direction.z*t;
      if(px*px+py*py+pz*pz<.75)best=t;
    }
    if(!Number.isFinite(best))return false;
    const wallHit=new THREE.Raycaster(origin,direction,0,Math.min(best+.05,50)).intersectObjects(obstacleMeshes,false)[0];
    return !wallHit||wallHit.distance>best-.05;
  }
  function updateAim(dt){syncCrosshairVisibility();if(spectating)return;spreadKick=Math.max(0,spreadKick-dt*24);weaponHeat.forEach((heat,id)=>{const recovery=WEAPONS[id]?.heatRecovery??1.45;weaponHeat.set(id,Math.max(0,heat-dt*recovery));});
    // 指数回正参数来自服务端目录，因此新增枪械不需要再增加 weaponId 分支。
    const pitchRecovery=WEAPONS[weapon]?.pitchRecovery??5.5,yawRecovery=WEAPONS[weapon]?.yawRecovery??6;
    aimRecoilPitch*=Math.exp(-pitchRecovery*dt);aimRecoilYaw*=Math.exp(-yawRecovery*dt);
    $('crosshair').style.setProperty('--gap',(4+spreadKick)+'px');$('crosshair').classList.toggle('tracking',serverLikeAimCandidate());}
  function combatWeaponName(weaponId){return weaponId==='frag_grenade'?'破片手雷':WEAPONS[weaponId]?.name||weaponId||'未知武器';}
  function die(report){
    const firstTransition=!dead;dead=true;scope(false);hideBuffSelection(false);$('deathKiller').textContent=report?.killer||'未知攻击者';const weaponName=combatWeaponName(report?.weapon),distance=Number.isFinite(report?.distance)?`${report.distance.toFixed(1)}m`:'--';$('deathWeapon').textContent=`${weaponName} · ${distance}${report?.headshot?' · 爆头':''}`;$('death').classList.remove('hidden');releaseGamePointerLock();
    // A delayed kill event may arrive after the snapshot fallback. It can enrich the report,
    // but must not restart the countdown and postpone respawn by another full interval.
    if(!firstTransition)return;
    clearInterval(respawnTimer);deathDeadline=performance.now()+Math.max(0,report?.respawnDelayMs??3000);const update=()=>{const remaining=Math.max(0,deathDeadline-performance.now());$('respawnCountdown').textContent=remaining>0?`${Math.ceil(remaining/1000)} 秒后自动重生`:'正在重生...';if(remaining<=0){clearInterval(respawnTimer);send({type:'respawn'});}};update();respawnTimer=setInterval(update,100);
  }
  function showPickup(weaponId,replacedWeapon,itemType='WEAPON'){const hint=$('pickupHint'),name=itemType==='WEAPON'?(WEAPONS[weaponId]?.name||weaponId):(SUPPLY_META[itemType]?.name||'补给'),oldName=WEAPONS[replacedWeapon]?.name||replacedWeapon;hint.textContent=replacedWeapon?`已用 ${name} 替换 ${oldName}`:`已拾取 ${name}`;hint.classList.remove('hidden');setTimeout(()=>hint.classList.add('hidden'),3500);}
  let weaponHintTimer;function showWeaponState(text){const hint=$('weaponStateHint');hint.textContent=text;hint.classList.remove('hidden');clearTimeout(weaponHintTimer);weaponHintTimer=setTimeout(()=>hint.classList.add('hidden'),700);}
  let buffTriggerTimer=0,lastBuffTriggerKey='',lastBuffTriggerAt=0;
  function showBuffTriggered(data){
    const now=performance.now(),key=`${data.perspective}:${data.buff}:${data.outcome}`;
    if(key===lastBuffTriggerKey&&now-lastBuffTriggerAt<450)return;
    lastBuffTriggerKey=key;lastBuffTriggerAt=now;
    const owner=data.perspective==='OWNER',deflected=data.outcome==='DEFLECTED';
    const node=$('buffTrigger'),icon=node.querySelector('i'),message=node.querySelector('span');
    icon.textContent=deflected?'↗':'×';
    message.textContent=owner
      ?(deflected?'弹道偏左生效，已偏转攻击':'没有子弹生效，已干扰对方武器')
      :(deflected?'目标的弹道偏左生效':'目标的没有子弹生效，武器暂时卡顿');
    node.className=`${owner?'owner':'attacker'} ${deflected?'deflected':'jammed'}`;
    clearTimeout(buffTriggerTimer);buffTriggerTimer=setTimeout(()=>node.classList.add('hidden'),1100);
    playBuffTriggerSound(owner);
  }
  let audioContext,gunNoiseBuffer,musicBus,sfxBus,musicTimer,musicStep=0;
  const gunAudioBuffers=Object.create(null),libraryAudioBuffers=Object.create(null),footstepAudioBuffers=[];
  let gunAudioLoadPromise=null;
  const weaponAudioConfig=(weaponId=weapon)=>weaponAssets[weaponId]?.audio||{};
  let lastWeaponAction='READY';
  /**
   * 音乐和音效使用独立总线。当前版本尚未接入正式音乐资源，但 musicBus 已成为
   * 稳定接口；以后大厅音乐和战斗音乐只需连接到它，不需要修改设置面板。
   */
  function ensureAudio(){if(audioContext)return audioContext;const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)return null;audioContext=new AudioContext();musicBus=audioContext.createGain();sfxBus=audioContext.createGain();musicBus.connect(audioContext.destination);sfxBus.connect(audioContext.destination);applyAudioSettings();gunNoiseBuffer=audioContext.createBuffer(1,Math.floor(audioContext.sampleRate*.35),audioContext.sampleRate);const data=gunNoiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,2);startAmbientMusic();return audioContext;}
  function applyAudioSettings(){if(!audioContext)return;musicBus.gain.setTargetAtTime(appSettings.audio.musicEnabled?appSettings.audio.musicVolume:0,audioContext.currentTime,.02);sfxBus.gain.setTargetAtTime(appSettings.audio.sfxEnabled?appSettings.audio.sfxVolume:0,audioContext.currentTime,.02);}
  /** 轻量占位旋律完全走 musicBus，正式音乐资源接入后可以直接替换该函数。 */
  function startAmbientMusic(){if(!audioContext||musicTimer)return;const notes=[110,164.81,220,196,146.83,220,261.63,196];const playNote=()=>{const now=audioContext.currentTime,osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type='sine';osc.frequency.value=notes[musicStep++%notes.length];gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.028,now+.08);gain.gain.exponentialRampToValueAtTime(.0001,now+.72);osc.connect(gain);gain.connect(musicBus);osc.start(now);osc.stop(now+.75);};playNote();musicTimer=setInterval(playNote,760);}
  function playBoltSound(weaponId){const preferred=weaponId==='sniper'?'sniper-cycle.ogg':'assault-rifle-reload.ogg';if(libraryAudioBuffers[preferred]){playLibrarySound(preferred,camera.position,weaponAudioConfig(weaponId).cycleVolume??(weaponId==='sniper'?.72:.58));return;}const context=ensureAudio();if(!context||!sfxBus)return;if(context.state==='suspended')context.resume();const now=context.currentTime,osc=context.createOscillator(),gain=context.createGain();osc.type='square';osc.frequency.setValueAtTime(145,now);osc.frequency.exponentialRampToValueAtTime(65,now+.16);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.12,now+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+.18);osc.connect(gain);gain.connect(sfxBus);osc.start(now);osc.stop(now+.2);}
  function playGrenadePinSound(){const context=ensureAudio();if(!context||!sfxBus)return;if(context.state==='suspended')context.resume();const now=context.currentTime,osc=context.createOscillator(),gain=context.createGain();osc.type='triangle';osc.frequency.setValueAtTime(1250,now);osc.frequency.exponentialRampToValueAtTime(420,now+.11);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.1,now+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+.13);osc.connect(gain);gain.connect(sfxBus);osc.start(now);osc.stop(now+.14);}
  function playBuffTriggerSound(owner){const context=ensureAudio();if(!context||!sfxBus)return;if(context.state==='suspended')context.resume();const now=context.currentTime,osc=context.createOscillator(),gain=context.createGain();osc.type='sine';osc.frequency.setValueAtTime(owner?720:310,now);osc.frequency.exponentialRampToValueAtTime(owner?1080:190,now+.12);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.07,now+.01);gain.gain.exponentialRampToValueAtTime(.0001,now+.15);osc.connect(gain);gain.connect(sfxBus);osc.start(now);osc.stop(now+.16);}
  function playGrenadeExplosionSound(position){const context=ensureAudio();if(!context||!sfxBus)return;if(context.state==='suspended')context.resume();const now=context.currentTime,distance=position.distanceTo(camera.position),attenuation=Math.min(1,1/(1+distance*.08)),master=context.createGain(),panner=context.createStereoPanner?context.createStereoPanner():null;master.gain.value=.9*attenuation;if(panner){const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),direction=position.clone().sub(camera.position).normalize();panner.pan.value=THREE.MathUtils.clamp(direction.dot(right),-1,1);master.connect(panner);panner.connect(sfxBus)}else master.connect(sfxBus);const noise=context.createBufferSource(),filter=context.createBiquadFilter(),noiseGain=context.createGain();noise.buffer=gunNoiseBuffer;filter.type='lowpass';filter.frequency.setValueAtTime(1800,now);filter.frequency.exponentialRampToValueAtTime(180,now+.34);noiseGain.gain.setValueAtTime(.85,now);noiseGain.gain.exponentialRampToValueAtTime(.001,now+.34);noise.connect(filter);filter.connect(noiseGain);noiseGain.connect(master);noise.start(now);noise.stop(now+.34);const rumble=context.createOscillator(),rumbleGain=context.createGain();rumble.type='sine';rumble.frequency.setValueAtTime(82,now);rumble.frequency.exponentialRampToValueAtTime(26,now+.52);rumbleGain.gain.setValueAtTime(.9,now);rumbleGain.gain.exponentialRampToValueAtTime(.001,now+.55);rumble.connect(rumbleGain);rumbleGain.connect(master);rumble.start(now);rumble.stop(now+.56);}
  /** 程序化枪声由低频冲击和滤波噪声组成；以后可用同一 weaponId 替换为真实音频资源。 */
  function playLibrarySound(name,position,volume=.7,pitchVariance=.03){
    const context=ensureAudio(),buffer=libraryAudioBuffers[name];if(!context||!buffer||!sfxBus)return;
    if(context.state==='suspended')context.resume();
    const master=context.createGain(),panner=context.createStereoPanner?context.createStereoPanner():null;master.gain.value=Math.min(5,volume);
    if(position){const distance=position.distanceTo(camera.position),attenuation=Math.min(1,1/(1+distance*.08));master.gain.value*=attenuation;if(panner){const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),toSound=position.clone().sub(camera.position).normalize();panner.pan.value=THREE.MathUtils.clamp(toSound.dot(right),-1,1);master.connect(panner);panner.connect(sfxBus);}else master.connect(sfxBus);}else master.connect(sfxBus);
    const source=context.createBufferSource();source.buffer=buffer;source.playbackRate.value=1-pitchVariance+Math.random()*pitchVariance*2;source.connect(master);source.start();
  }
  function playFootstepSound(sprint=false,position=null){
    const context=ensureAudio();if(!context||!sfxBus||!gunNoiseBuffer)return;
    if(context.state==='suspended')context.resume();
    if(footstepAudioBuffers.length){
      const source=context.createBufferSource(),filter=context.createBiquadFilter(),master=context.createGain(),panner=context.createStereoPanner?context.createStereoPanner():null;source.buffer=footstepAudioBuffers[Math.floor(Math.random()*footstepAudioBuffers.length)];source.playbackRate.value=(sprint?1.16:1.10)*(.97+Math.random()*.06);filter.type='highpass';filter.frequency.value=150;master.gain.value=sprint?.82:.64;source.connect(filter);filter.connect(master);
      if(position){const distance=position.distanceTo(camera.position);master.gain.value*=Math.min(1,1/(1+distance*.1));if(panner){const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),direction=position.clone().sub(camera.position).normalize();panner.pan.value=THREE.MathUtils.clamp(direction.dot(right),-1,1);master.connect(panner);panner.connect(sfxBus);}else master.connect(sfxBus)}else master.connect(sfxBus);source.start();return;
    }
    const now=context.currentTime,master=context.createGain(),filter=context.createBiquadFilter(),source=context.createBufferSource(),impact=context.createOscillator(),impactGain=context.createGain();
    master.gain.value=sprint?.34:.25;filter.type='lowpass';filter.frequency.value=sprint?1100:850;
    source.buffer=gunNoiseBuffer;source.playbackRate.value=sprint?1.55:1.25;source.connect(filter);filter.connect(master);
    impact.type='triangle';impact.frequency.setValueAtTime(sprint?105:88,now);impact.frequency.exponentialRampToValueAtTime(42,now+.095);
    impactGain.gain.setValueAtTime(.22,now);impactGain.gain.exponentialRampToValueAtTime(.001,now+.105);impact.connect(impactGain);impactGain.connect(master);
    if(position){const distance=position.distanceTo(camera.position);master.gain.value*=Math.min(1,1/(1+distance*.1));const panner=context.createStereoPanner?context.createStereoPanner():null;if(panner){const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),direction=position.clone().sub(camera.position).normalize();panner.pan.value=THREE.MathUtils.clamp(direction.dot(right),-1,1);master.connect(panner);panner.connect(sfxBus);}else master.connect(sfxBus);}else master.connect(sfxBus);
    source.start(now);source.stop(now+.075);impact.start(now);impact.stop(now+.11);
  }
  async function preloadFootstepPack(context){try{const response=await fetch('assets/audio/footsteps/footsteps.json',{cache:'force-cache'});if(!response.ok)throw new Error('HTTP '+response.status);const pack=await response.json();for(const encoded of pack.clips||[]){const binary=atob(encoded),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);footstepAudioBuffers.push(await context.decodeAudioData(bytes.buffer));}}catch(error){console.warn('Footstep pack failed; synthesized fallback remains',error);}}
  function decodePackedAudio(context,encoded){const binary=atob(encoded),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);return context.decodeAudioData(bytes.buffer);}
  async function preloadGunAudio(){
    if(gunAudioLoadPromise)return gunAudioLoadPromise;const context=ensureAudio();if(!context)return Promise.resolve();
    gunAudioLoadPromise=(async()=>{try{
      // Fetch one JSON document instead of individual .ogg URLs. Besides reducing request
      // overhead this prevents browser download extensions from hijacking in-game audio.
      const audioStartedAt=performance.now(),fetchStartedAt=performance.now();
      const response=await fetch('assets/audio/audio-pack.json',{cache:'force-cache'});if(!response.ok)throw new Error('HTTP '+response.status);
      const packedText=await response.text();recordAssetTiming('audioFetchMs',fetchStartedAt);
      const parseStartedAt=performance.now(),pack=JSON.parse(packedText),clips=pack.clips||{};recordAssetTiming('audioJsonParseMs',parseStartedAt);
      const decodeStartedAt=performance.now();
      // Decode sequentially rather than launching fourteen decoders at once. The parallel
      // version shortened the loading bar slightly but caused a large allocation/GC spike
      // immediately after entering the arena on mid-range machines.
      for(const [weaponId,contract] of Object.entries(weaponAssets)){const key=contract.audio?.url?.replace(/^assets\/audio\//,'');if(key&&clips[key]){gunAudioBuffers[weaponId]=await decodePackedAudio(context,clips[key]);await new Promise(requestAnimationFrame);}}
      for(const [key,encoded] of Object.entries(clips)){if(!key.startsWith('library/'))continue;libraryAudioBuffers[key.slice('library/'.length)]=await decodePackedAudio(context,encoded);await new Promise(requestAnimationFrame);}
      recordAssetTiming('audioDecodeMs',decodeStartedAt);recordAssetTiming('audioTotalMs',audioStartedAt);
    }catch(error){console.warn('Packed audio failed; procedural fallback remains',error);}await preloadFootstepPack(context);})();return gunAudioLoadPromise;
  }

  /**
   * Keep the loading cover visible until both the authoritative spawn and a world frame
   * rendered from that spawn have reached the browser compositor. Resolving on the socket
   * message alone exposed one stale blue camera frame on slower production clients.
   */
  function waitForAuthoritativeEntry(timeoutMs=8_000){
    rejectAuthoritativeEntry(new Error('entry_superseded'));
    document.body.dataset.entryState='waiting';
    document.body.dataset.entryFrameState='waiting';
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{if(!entryStateWaiter)return;entryStateWaiter=null;document.body.dataset.entryState='timeout';document.body.dataset.entryFrameState='timeout';reject(new Error('服务器出生确认超时'));},timeoutMs);
      entryStateWaiter={
        authoritative:false,
        rendered:false,
        commitQueued:false,
        resolve:()=>{clearTimeout(timer);entryStateWaiter=null;document.body.dataset.entryState='ready';document.body.dataset.entryFrameState='ready';resolve();},
        reject:error=>{clearTimeout(timer);entryStateWaiter=null;document.body.dataset.entryState='failed';document.body.dataset.entryFrameState='failed';reject(error);}
      };
    });
  }
  function resolveAuthoritativeEntry(){if(entryStateWaiter){entryStateWaiter.authoritative=true;document.body.dataset.entryState='spawn-applied';}}
  function markAuthoritativeEntryFrameRendered(){
    const waiter=entryStateWaiter;if(!waiter?.authoritative||waiter.commitQueued)return;
    waiter.rendered=true;waiter.commitQueued=true;document.body.dataset.entryFrameState='rendered';
    // This callback can only run after the first authoritative frame was submitted.
    requestAnimationFrame(()=>{if(entryStateWaiter===waiter&&waiter.authoritative&&waiter.rendered)waiter.resolve();});
  }
  function rejectAuthoritativeEntry(error){entryStateWaiter?.reject(error);}
  function playGunSound(weaponId,position){const context=ensureAudio();if(!context)return;if(context.state==='suspended')context.resume();const sound=weaponAssets[weaponId]?.audio||{frequency:120,duration:.15,filter:1500,volume:.55};const distance=position.distanceTo(camera.position),attenuation=Math.min(1,1/(1+distance*.065));const master=context.createGain(),panner=context.createStereoPanner?context.createStereoPanner():null;master.gain.value=(sound.volume??.55)*attenuation;if(panner){const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),toSound=position.clone().sub(camera.position).normalize();panner.pan.value=THREE.MathUtils.clamp(toSound.dot(right),-1,1);master.connect(panner);panner.connect(sfxBus);}else master.connect(sfxBus);const buffer=gunAudioBuffers[weaponId];if(buffer){const source=context.createBufferSource();source.buffer=buffer;const range=sound.pitchRange||[1,1];source.playbackRate.value=range[0]+Math.random()*(range[1]-range[0]);source.connect(master);source.start();return;}const noise=context.createBufferSource(),filter=context.createBiquadFilter(),noiseGain=context.createGain();noise.buffer=gunNoiseBuffer;filter.type='lowpass';filter.frequency.value=sound.filter;noiseGain.gain.setValueAtTime(1,context.currentTime);noiseGain.gain.exponentialRampToValueAtTime(.001,context.currentTime+sound.duration);noise.connect(filter);filter.connect(noiseGain);noiseGain.connect(master);noise.start();noise.stop(context.currentTime+sound.duration);const boom=context.createOscillator(),boomGain=context.createGain();boom.type='triangle';boom.frequency.setValueAtTime(sound.frequency,context.currentTime);boom.frequency.exponentialRampToValueAtTime(32,context.currentTime+sound.duration);boomGain.gain.setValueAtTime(.75,context.currentTime);boomGain.gain.exponentialRampToValueAtTime(.001,context.currentTime+sound.duration);boom.connect(boomGain);boomGain.connect(master);boom.start();boom.stop(context.currentTime+sound.duration);}
  function triggerFireView(){const view=weaponViews[weapon];if(!view)return;const definition=WEAPONS[weapon],motion=view.userData.assetConfig?.viewMotion||{},multiplier=(definition.viewKickScale??1)*(motion.fireImpulseScale??1);recoilImpulse=Math.min(motion.maxRecoilImpulse??.28,recoilImpulse+(.035+definition.kick*.002)*multiplier);recoilYaw+=(Math.random()-.5)*(definition.horizontalRecoil??.018)*6*(motion.yawImpulseScale??1);syncMuzzleAttachment(view);const effects=view.userData.skinEffects||view.userData.assetConfig?.effects||{};view.userData.muzzleEffect.trigger(effects);playAssetFire(view);spawnCasing(view);}

  /** 根据服务端动作时间轴驱动占位模型；换成 GLB 后只需把进度映射到 AnimationAction。 */
  function updateWeaponView(time,dt){
    if(spectating){Object.values(weaponViews).forEach(view=>view.visible=false);exitKnifeMode();grenadeThrowView.visible=false;camera.fov=75;camera.updateProjectionMatrix();return;}
    const config=WEAPONS[weapon];if(!config)return;
    const aimStep=dt*1000/Math.max(1,config.aimIn||1);aimProgress+=Math.sign(aimTarget-aimProgress)*Math.min(Math.abs(aimTarget-aimProgress),aimStep);
    const eased=aimProgress*aimProgress*(3-2*aimProgress),nextFov=75+(25-75)*eased;if(Math.abs(camera.fov-nextFov)>.001){camera.fov=nextFov;camera.updateProjectionMatrix();viewModelCamera.fov=nextFov;viewModelCamera.updateProjectionMatrix();}$('scope').style.setProperty('--scope-progress',aimProgress.toFixed(3));$('scope').classList.toggle('hidden',aimProgress<.88);
    recoilImpulse*=Math.pow(.025,dt);recoilYaw*=Math.pow(.04,dt);Object.values(weaponViews).forEach(view=>{view.userData.muzzleEffect?.update(dt);view.userData.mixer?.update(dt);});const moving=Math.abs(keys.KeyW?1:0)+Math.abs(keys.KeyS?1:0)+Math.abs(keys.KeyA?1:0)+Math.abs(keys.KeyD?1:0);
    const now=Date.now(),serverAction=me?.weaponAction||'READY',serverThrowing=serverAction==='THROWING_GRENADE';
    // Start the first-person throw on mouse release instead of waiting for the
    // next server snapshot. Keep that one local timeline after confirmation so
    // latency cannot briefly show the gun and then restart the right-arm throw.
    const predictedThrow=localGrenadeThrowStartedAt>0&&(serverThrowing||now<localGrenadeThrowStartedAt+THROW_DURATION_MS);
    const action=predictedThrow?'THROWING_GRENADE':serverAction,start=predictedThrow?localGrenadeThrowStartedAt:(me?.weaponActionStartedAt||0),end=predictedThrow?localGrenadeThrowStartedAt+THROW_DURATION_MS:(me?.weaponActionUntil||0),commit=predictedThrow?localGrenadeThrowStartedAt+THROW_COMMIT_MS:(me?.weaponActionCommitAt||0),progress=end>start?Math.max(0,Math.min(1,(now-start)/(end-start))):1,commitProgress=end>start&&commit>start?(commit-start)/(end-start):.78,throwing=action==='THROWING_GRENADE';
    if(localGrenadeThrowStartedAt&&serverAction!=='THROWING_GRENADE'&&now>=localGrenadeThrowStartedAt+THROW_DURATION_MS)localGrenadeThrowStartedAt=0;
    Object.entries(weaponViews).forEach(([id,view])=>{view.visible=id===weapon&&!throwableEquipped&&!(config.category==='SNIPER_RIFLE'&&aimProgress>.82)&&(!throwing||progress>=.98);});
    if(config.category==='MELEE'){if(throwableEquipped||throwing){exitKnifeMode();updateGrenadeThrowView(action,progress,commitProgress);}else updateKnifeView();lastWeaponAction=action;return;}
    exitKnifeMode();
    const view=weaponViews[weapon];if(!view)return;syncAssetAction(view,action,progress);syncMuzzleAttachment(view);updateGrenadeThrowView(action,progress,commitProgress);const actionHint=$('weaponActionHint'),cycling=action==='CYCLING';actionHint.classList.toggle('hidden',!cycling);if(cycling){actionHint.style.setProperty('--action-progress',Math.round(progress*100)+'%');}if(action==='CYCLING'&&lastWeaponAction!=='CYCLING'&&weapon!=='sniper')playBoltSound(weapon);if(throwing&&lastWeaponAction!=='THROWING_GRENADE'&&!localGrenadeThrowStartedAt)playGrenadePinSound();lastWeaponAction=action;
    // ViewModel motion is visual only. Per-asset coefficients prevent differently
    // scaled source models from turning the same world-space offset into a huge arc.
    const motion=view.userData.assetConfig?.viewMotion||{},bob=moving?Math.sin(time*(motion.bobFrequency??.012))*(motion.bobAmplitude??.012):0;
    const base=view.userData.basePosition,baseRotation=view.userData.baseRotation;view.position.set(base.x+recoilYaw*(motion.recoilYawPosition??.25),base.y+bob,base.z+recoilImpulse*(motion.recoilPosition??1));view.rotation.set(baseRotation.x+recoilImpulse*(motion.recoilPitch??2.2),baseRotation.y+recoilYaw*(motion.recoilYaw??1),baseRotation.z+bob*(motion.bobRoll??.7));if(!view.userData.clips.has('reload'))view.userData.mag.position.y=view.userData.baseMagY;if(!view.userData.clips.has('fire')&&!view.userData.clips.has('cycle'))view.userData.bolt.position.z=.05;
    // 只有资源缺少对应动画时才使用程序化占位，避免 GLB 动画与外层旋转叠加两次。
    if(action==='EQUIPPING'&&!view.userData.clips.has('equip')){const motion=view.userData.assetConfig?.equipMotion||{drop:.65,roll:.35};view.position.y-=Math.max(0,1-progress)*motion.drop;view.rotation.z=(1-progress)*motion.roll;}
    else if(action==='RELOADING'&&!view.userData.clips.has('reload')){
      view.rotation.z=Math.sin(Math.PI*progress)*(motion.reloadRoll??.65);view.position.y-=Math.sin(Math.PI*progress)*(motion.reloadDrop??.16);
      // 同一个占位弹匣分两段运动：先取下旧弹匣，再在服务端 commit 前插入新弹匣。
      // 正式手臂动画会监听同一 commit 时刻，因此视觉与弹药生效不会各自猜时间。
      const detachEnd=Math.min(.38,commitProgress*.48),insertStart=Math.max(detachEnd+.08,commitProgress-.28);
      let travel;if(progress<detachEnd)travel=progress/detachEnd;else if(progress<insertStart)travel=1;else if(progress<commitProgress)travel=1-(progress-insertStart)/Math.max(.01,commitProgress-insertStart);else travel=0;
      view.userData.mag.position.y=view.userData.baseMagY-Math.max(0,Math.min(1,travel))*(motion.magTravel??.45);
    }
    else if(action==='CYCLING'&&!view.userData.clips.has('cycle')){const cycle=Math.sin(Math.PI*progress);view.userData.bolt.position.z=.05+cycle*.28;view.rotation.x+=cycle*.07;}
    else if(throwing&&progress>.68){const recovery=(progress-.68)/.32;view.position.y-=(1-recovery)*.34;view.rotation.z+=(1-recovery)*.16;}
  }
  function showDamage(value,headshot,variant=''){const node=document.createElement('div');node.className=`damageNumber${headshot?' head':''}${variant?' '+variant:''}`;node.textContent=String(Math.max(0,Math.round(Number(value)||0)));$('damageNumbers').append(node);setTimeout(()=>node.remove(),800);}
  function showConfirmedHit(data){const headshot=data.part==='head',crosshair=$('crosshair');crosshair.classList.add('enemy');$('hit').textContent='✕';$('hit').classList.toggle('headshot',headshot);$('hit').style.display='block';showDamage(data.damage,headshot);if(libraryAudioBuffers['hit-body-5.ogg'])playLibrarySound('hit-body-5.ogg',camera.position,.32);setTimeout(()=>{crosshair.classList.remove('enemy');$('hit').style.display='none';},160);}
  function showDamageTaken(data){
    const relative=Math.atan2(Math.sin((data.sourceYaw||0)-state.yaw),Math.cos((data.sourceYaw||0)-state.yaw));
    const indicator=$('damageDirection');indicator.style.setProperty('--damage-angle',`${-relative}rad`);indicator.classList.remove('hidden','active');void indicator.offsetWidth;indicator.classList.add('active');
    clearTimeout(damageIndicatorTimer);damageIndicatorTimer=setTimeout(()=>indicator.classList.add('hidden'),720);
    canvas.classList.remove('damage');void canvas.offsetWidth;canvas.classList.add('damage');setTimeout(()=>canvas.classList.remove('damage'),360);
  }
  /**
   * 表现层对象池：弹道、命中碎屑、弹壳、爆炸火球都是高频短命对象。过去每次都 new 几何体和材质，
   * 结束时 dispose，导致持续的 GC 与 GPU 上传，拖低 1% Low。现在几何体按形状共享，Mesh 连同
   * 自己的材质回收复用；调用方每次取出后重新设置颜色、透明度和变换。
   */
  const sharedFxGeometries=new Map(),fxMeshPools=new Map(),FX_POOL_CAP=96;
  function sharedFxGeometry(key,factory){let geometry=sharedFxGeometries.get(key);if(!geometry){geometry=factory();sharedFxGeometries.set(key,geometry);}return geometry;}
  function acquireFxMesh(key,geometryFactory,materialFactory){const pool=fxMeshPools.get(key);let mesh=pool&&pool.pop();if(!mesh){mesh=new THREE.Mesh(sharedFxGeometry(key,geometryFactory),materialFactory());mesh.userData.fxPoolKey=key;mesh.userData.velocity=new THREE.Vector3();mesh.userData.angularVelocity=new THREE.Vector3();}mesh.position.set(0,0,0);mesh.rotation.set(0,0,0);mesh.scale.set(1,1,1);mesh.visible=true;return mesh;}
  function releaseFxMesh(mesh,container){(container||mesh.parent)?.remove(mesh);const key=mesh.userData.fxPoolKey;if(!key){mesh.geometry?.dispose();mesh.material?.dispose();return;}let pool=fxMeshPools.get(key);if(!pool){pool=[];fxMeshPools.set(key,pool);}if(pool.length<FX_POOL_CAP)pool.push(mesh);else mesh.material?.dispose();}
  const additiveFxMaterial=()=>new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1,depthWrite:false,blending:THREE.AdditiveBlending});
  const transparentFxMaterial=()=>new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1});
  const softFxMaterial=()=>new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1,depthWrite:false});
  function pushFxParticle(mesh,container,life,maxLife,options){const velocity=mesh.userData.velocity;if(options.velocity)velocity.copy(options.velocity);else velocity.set(0,0,0);const record={object:mesh,container,velocity,life,maxLife,gravity:options.gravity||0,smoke:!!options.smoke,spark:!!options.spark,angularVelocity:null};if(options.angular){record.angularVelocity=mesh.userData.angularVelocity.copy(options.angular);}visualParticles.push(record);return record;}
  const _fxCasingOrigin=new THREE.Vector3(),_fxVelocity=new THREE.Vector3(),_fxAngular=new THREE.Vector3(),_fxUp=new THREE.Vector3(0,0,1);
  /**
   * 爆炸灯光池：灯光数量变化会让所有受光材质重新编译着色器，造成投掷手雷后的明显卡顿。
   * 这里在开局固定创建灯光、常驻场景，爆炸时只改位置、颜色和亮度，数量永不变化。
   */
  const EXPLOSION_LIGHT_POOL_SIZE=2,explosionLights=[];let explosionLightCursor=0;
  for(let i=0;i<EXPLOSION_LIGHT_POOL_SIZE;i++){const light=new THREE.PointLight(0xffffff,0,13,2);light.userData.fadeStartedAt=0;light.userData.fadeDuration=0;light.userData.peak=0;scene.add(light);explosionLights.push(light);}
  function flashExplosionLight(color,intensity,distance,x,y,z,durationMs){const light=explosionLights[explosionLightCursor];explosionLightCursor=(explosionLightCursor+1)%explosionLights.length;light.color.setHex(color);light.distance=distance;light.position.set(x,y,z);light.intensity=intensity;light.userData.peak=intensity;light.userData.fadeStartedAt=performance.now();light.userData.fadeDuration=durationMs;}
  function updateExplosionLights(now){for(let i=0;i<explosionLights.length;i++){const light=explosionLights[i],data=light.userData;if(light.intensity<=0)continue;const t=(now-data.fadeStartedAt)/Math.max(1,data.fadeDuration);light.intensity=t>=1?0:data.peak*(1-t*t);}}
  function spawnGrenadeExplosion(data){
    const center=new THREE.Vector3(data.x,data.y,data.z);if(libraryAudioBuffers['grenade-explosion.ogg'])playLibrarySound('grenade-explosion.ogg',center,.9);else playGrenadeExplosionSound(center);
    const core=acquireFxMesh('explosion-core',()=>new THREE.SphereGeometry(.62,12,9),additiveFxMaterial);core.material.color.setHex(0xfff2bd);core.material.opacity=.95;core.position.copy(center);scene.add(core);pushFxParticle(core,scene,.2,.2,{});
    const fireball=acquireFxMesh('explosion-fireball',()=>new THREE.SphereGeometry(.95,12,9),additiveFxMaterial);fireball.material.color.setHex(0xff7d24);fireball.material.opacity=.5;fireball.position.copy(center);scene.add(fireball);pushFxParticle(fireball,scene,.42,.42,{velocity:_fxVelocity.set(0,.15,0),smoke:true});
    const shockwave=acquireFxMesh('explosion-shockwave',()=>new THREE.TorusGeometry(1.05,.065,6,24),additiveFxMaterial);shockwave.material.color.setHex(0xffc267);shockwave.material.opacity=.62;shockwave.position.copy(center);shockwave.rotation.x=Math.PI/2;scene.add(shockwave);pushFxParticle(shockwave,scene,.48,.48,{smoke:true});
    const available=Math.max(0,quality.particles-visualParticles.length),sparkCount=Math.min(24,available);
    for(let i=0;i<sparkCount;i++){const spark=acquireFxMesh('explosion-spark',()=>new THREE.OctahedronGeometry(.045,0),transparentFxMaterial);spark.material.color.setHex(i%3?0xff8d2d:0xffe6a3);spark.material.opacity=1;spark.position.copy(center);_fxVelocity.set(Math.random()-.5,.16+Math.random()*.85,Math.random()-.5).normalize().multiplyScalar(4+Math.random()*7);scene.add(spark);pushFxParticle(spark,scene,.45+Math.random()*.4,.85,{velocity:_fxVelocity,gravity:9,spark:true});}
    for(let i=0;i<5&&visualParticles.length<quality.particles;i++){const smoke=acquireFxMesh('explosion-smoke',()=>new THREE.SphereGeometry(.22,7,5),softFxMaterial);smoke.material.color.setHex(0x687077);smoke.material.opacity=.24;smoke.scale.setScalar(1+Math.random()*.55);smoke.position.set(center.x+(Math.random()-.5)*.45,center.y+Math.random()*.3,center.z+(Math.random()-.5)*.45);scene.add(smoke);pushFxParticle(smoke,scene,1.15+Math.random()*.45,1.6,{velocity:_fxVelocity.set((Math.random()-.5)*.45,.55+Math.random()*.45,(Math.random()-.5)*.45),smoke:true});}
    flashExplosionLight(0xff8d35,4.8,13,center.x,center.y+.35,center.z,130);
    const distance=camera.position.distanceTo(center);if(!spectating&&distance<14)recoilImpulse=Math.max(recoilImpulse,(1-distance/14)*.085);
    if(data.ownerId===id)for(const victim of(data.victims||[]))showDamage(victim.damage,false,'explosive');
  }
  function spawnFlashDetonation(data){
    const center=new THREE.Vector3(data.x,data.y,data.z),core=acquireFxMesh('flash-core',()=>new THREE.SphereGeometry(.32,10,7),additiveFxMaterial);core.material.color.setHex(0xffffff);core.material.opacity=1;core.position.copy(center);scene.add(core);pushFxParticle(core,scene,.16,.16,{});
    // A short, pale ground ring communicates the detonation point without implying damage.
    const ring=acquireFxMesh('flash-ring',()=>new THREE.RingGeometry(1.3,1.55,32),()=>{const material=additiveFxMaterial();material.side=THREE.DoubleSide;return material;});ring.material.color.setHex(0xd9f4ff);ring.material.opacity=.38;ring.position.copy(center);ring.position.y+=.035;ring.rotation.x=-Math.PI/2;scene.add(ring);pushFxParticle(ring,scene,.32,.32,{smoke:true});
    flashExplosionLight(0xeef8ff,7,16,center.x,center.y,center.z,90);
  }
  function applyFlashEffect(data){const intensity=THREE.MathUtils.clamp(Number(data.intensity)||0,0,1),duration=Math.max(260,Number(data.durationMs)||700),overlay=$('flashEffect');overlay.classList.remove('hidden','recovering');overlay.style.setProperty('--flash-opacity',String(.42+.58*intensity));overlay.style.setProperty('--flash-duration',`${duration}ms`);void overlay.offsetWidth;overlay.classList.add('active');setTimeout(()=>{overlay.classList.remove('active');overlay.classList.add('recovering');},90);setTimeout(()=>overlay.classList.add('hidden'),duration+120);const context=ensureAudio();if(!context||!sfxBus||!gunNoiseBuffer)return;const now=context.currentTime,master=context.createGain(),filter=context.createBiquadFilter(),noise=context.createBufferSource(),tone=context.createOscillator(),toneGain=context.createGain();master.gain.value=.22*intensity;filter.type='highpass';filter.frequency.value=2600;noise.buffer=gunNoiseBuffer;noise.loop=true;noise.connect(filter);filter.connect(master);tone.type='sine';tone.frequency.value=3400;toneGain.gain.setValueAtTime(.2*intensity,now);toneGain.gain.exponentialRampToValueAtTime(.001,now+Math.min(4,duration/1000));tone.connect(toneGain);toneGain.connect(master);master.connect(sfxBus);noise.start(now);tone.start(now);noise.stop(now+Math.min(3,duration/1000));tone.stop(now+Math.min(4,duration/1000));}
  function showShotResult(data){
    const shotId=Number(data.shotId)||0;if(shotId&&shotId<=lastResolvedShotId)return;lastResolvedShotId=Math.max(lastResolvedShotId,shotId);
    if(data.outcome!=='HIT')console.debug('[shot-result]',data);
    if(data.melee&&data.outcome==='BLOCKED'&&Array.isArray(data.hitPoint)&&Array.isArray(data.normal)){const point=new THREE.Vector3().fromArray(data.hitPoint),normal=new THREE.Vector3().fromArray(data.normal).normalize();spawnImpactParticles(point,normal,data.surface||'concrete');playMeleeImpact(data.surface);}
    if(data.outcome==='HIT')showConfirmedHit(data);
    else if(data.outcome==='NEGATED')showWeaponState('攻击被防御效果抵消');
    else if(data.outcome==='DEFLECTED'&&!data.buff)showWeaponState('弹道受到干扰');
    else if(data.outcome==='JAMMED'&&!data.buff)showWeaponState('武器受到干扰');
  }
  let killStreak=0,killConfirmTimer=0;
  function showKillConfirmation(data){const node=$('killConfirm');killStreak++;node.querySelector('small').textContent=data.headshot?'爆头击杀':'击杀确认';node.querySelector('strong').textContent=data.victim;node.querySelector('span').textContent=killStreak>1?`${killStreak} 连杀 · ${combatWeaponName(data.weapon)}`:combatWeaponName(data.weapon);node.className=data.headshot?'headshot':'';clearTimeout(killConfirmTimer);killConfirmTimer=setTimeout(()=>node.classList.add('hidden'),1250);}
  function showKill(data){
    const weaponName=combatWeaponName(data.weapon),distance=Number.isFinite(data.distance)?`${data.distance.toFixed(1)}m`:'';
    const detail=`${data.headshot?'<em>HEAD</em>':''}<img src="${weaponThumbnail(data.weapon)}" alt="${escapeHtml(weaponName)}"><small>${distance}</small>`;
    feed(`<b>${escapeHtml(data.killer)}</b><span class="kill-weapon">${detail}</span><b>${escapeHtml(data.victim)}</b>`,`${data.killerId===id?'mine ':''}${data.victimId===id?'against-me ':''}${data.counted?'':'warmup'}`);
    if(data.killerId===id&&data.victimId!==id)showKillConfirmation(data);
    if(data.victimId===id){killStreak=0;die(data);}
  }
  function feed(text,variant=''){const node=document.createElement('div');node.className=`kill ${variant}`.trim();node.innerHTML=text;$('feed').prepend(node);while($('feed').children.length>5)$('feed').lastElementChild.remove();setTimeout(()=>node.remove(),5000);}
  function chat(text,system=false){const node=document.createElement('div');node.className='msg'+(system?' system':'');node.innerHTML=text;$('messages').append(node);if(system)setTimeout(()=>node.remove(),6500);if($('messages').children.length>8)$('messages').firstChild.remove();}
  function renderScores(players){$('scores').innerHTML=players.sort((a,b)=>b.kills-a.kills).map((p,i)=>`<div class="score ${p.id===id?'me':''}"><b>${i+1}</b><span>${escapeHtml(p.name)}</span><span>击杀 ${p.kills}</span><span>死亡 ${p.deaths}</span></div>`).join('');}
  function send(data){if(ws&&ws.readyState===1)ws.send(JSON.stringify(data));}
  function escapeHtml(value){const node=document.createElement('div');node.textContent=value;return node.innerHTML;}
  function requestGamePointerLock(){if(document.pointerLockElement===canvas)return;const request=canvas.requestPointerLock();if(request&&typeof request.catch==='function')request.catch(()=>{});}
  document.querySelectorAll('#qualityControl button').forEach(button=>button.onclick=()=>applyQuality(button.dataset.quality));applyQuality(qualityName);

  let clientPreparation=null,entryPending=false,loadingValue=0,loadingDisplayValue=pendingEntryMode?8:0,loadingFrame=0,loadingHideTimer=0;
  function animateLoadingProgress(){
    loadingFrame=0;const difference=loadingValue-loadingDisplayValue;
    loadingDisplayValue=Math.abs(difference)<.15?loadingValue:loadingDisplayValue+difference*.14;
    const rendered=Math.round(loadingDisplayValue);$('loadingProgress').style.width=`${loadingDisplayValue.toFixed(2)}%`;$('loadingPercent').textContent=`${rendered}%`;
    if(Math.abs(loadingValue-loadingDisplayValue)>=.15)loadingFrame=requestAnimationFrame(animateLoadingProgress);
  }
  function updateLoading(stage,value){
    loadingValue=Math.max(loadingValue,Math.min(100,Math.round(value)));
    $('loadingStage').textContent=stage;if(!loadingFrame)loadingFrame=requestAnimationFrame(animateLoadingProgress);
    $('loadingScreen').querySelector('[role="progressbar"]').setAttribute('aria-valuenow',String(loadingValue));
  }
  function setLoadingVisible(visible){const screen=$('loadingScreen');clearTimeout(loadingHideTimer);if(visible){screen.classList.remove('hidden','leaving');return;}loadingValue=100;if(!loadingFrame)loadingFrame=requestAnimationFrame(animateLoadingProgress);screen.classList.add('leaving');loadingHideTimer=setTimeout(()=>{screen.classList.add('hidden');screen.classList.remove('leaving');frameSamples.length=0;longTaskCount=0;longTaskMs=0;pingSamples.length=0;pingMs=0;updateNetworkStatus();performanceGraceUntil=performance.now()+5_000;},260);}

  /**
   * 下载缓存只能减少网络耗时，不能替代 GLB 解析和 GPU Shader 初始化。这里同时等待地图、
   * 第一/第三人称武器资源完成安装，再主动编译世界与 ViewModel 两套场景。进入战斗后的
   * 首次开枪、首次看见某种材质因此不再承担大部分初始化尖峰。失败资源已有灰盒/枪模回退。
   */
  async function prepareClientAssets(){
    if(clientPreparation){await clientPreparation;updateLoading('客户端资源已就绪',94);return;}
    clientPreparation=(async()=>{
      const preparationStartedAt=performance.now();
      updateLoading('正在读取场景资源',12);
      const mapTask=Promise.resolve(mapVisualReady).then(()=>updateLoading('场景结构已就绪',55));
      const weaponTask=Promise.all([Promise.resolve(weaponAssetsReady),Promise.resolve(grenadeAssetsReady)]).then(async()=>{await preloadGunAudio();updateLoading('武器、手部与音频资源已就绪',78);});
      await Promise.all([mapTask,weaponTask]);
      updateLoading('正在预编译着色器',86);
      // 先让刚安装的 GLB 完成一次矩阵更新，再编译世界和第一人称独立渲染管线。
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const shaderStartedAt=performance.now();
      try{
        if(typeof renderer.compileAsync==='function')await Promise.all([renderer.compileAsync(scene,camera),renderer.compileAsync(viewModelScene,viewModelCamera)]);
        else{renderer.compile(scene,camera);renderer.compile(viewModelScene,viewModelCamera);}
      }catch(error){console.warn('Shader precompile failed; runtime compilation remains available',error);}
      recordAssetTiming('shaderCompileMs',shaderStartedAt);recordAssetTiming('clientPreparationMs',preparationStartedAt);
      console.info('Client asset timings (ms)',{...assetTimings});
      updateLoading('客户端资源已就绪',94);
    })();
    return clientPreparation;
  }

  syncSettingsUI();
  $('settingsSniperAimMode').onchange=event=>{sniperAimFireMode=event.target.value;appSettings.controls.sniperAimMode=sniperAimFireMode;saveSettings();syncSettingsUI();};
  $('settingsBotDifficulty').onchange=event=>{appSettings.training.botDifficulty=event.target.value;saveSettings();if(playing&&!spectating)send({type:'configure_bots',difficulty:event.target.value});syncSettingsUI();};
  ['musicEnabled','sfxEnabled'].forEach(id=>$(id).addEventListener('change',event=>{appSettings.audio[id]=event.target.checked;saveSettings();applyAudioSettings();syncSettingsUI();}));
  [['musicVolume','musicVolume'],['sfxVolume','sfxVolume'],['mouseSensitivity','mouseSensitivity'],['scopeSensitivity','scopeSensitivity']].forEach(([id,key])=>$(id).addEventListener('input',event=>{const value=Number(event.target.value);if(key==='mouseSensitivity'||key==='scopeSensitivity')appSettings.controls[key]=value;else appSettings.audio[key]=value;saveSettings();applyAudioSettings();syncSettingsUI();}));
  $('menuSettings').onclick=()=>setSettingsOpen(true);$('settingsButton').onclick=()=>setSettingsOpen(true);$('spectatorSettings').onclick=()=>setSettingsOpen(true);$('settingsClose').onclick=()=>setSettingsOpen(false);$('settingsResume').onclick=()=>setSettingsOpen(false);$('quitGame').onclick=quitGame;
  async function enterGame(asSpectator){
    if(!id||!mapCompatible||entryPending)return;entryPending=true;loadingValue=0;setLoadingVisible(true);updateLoading('正在准备竞技场',5);
    try{
      const shownAt=performance.now();ensureAudio();await prepareClientAssets();
      // 缓存命中时仍保留极短的视觉过渡，避免按钮点击后画面直接跳变。
      const remaining=900-(performance.now()-shownAt);if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
      ensureAudio();const playerName=$('name').value.trim()||'玩家';localStorage.setItem('neonArenaName',playerName);playing=true;spectating=asSpectator;dead=false;document.documentElement.classList.remove('pending-entry');document.body.classList.toggle('spectator-mode',spectating);const authoritativeEntry=waitForAuthoritativeEntry();send({type:'join',name:playerName,spectator:spectating});if(!spectating)send({type:'configure_bots',difficulty:appSettings.training.botDifficulty});$('menu').classList.add('hidden');$('hud').classList.remove('hidden');$('spectatorHud').classList.toggle('hidden',!spectating);if(spectating){spectatorMode='FREE';spectatorTargetId=null;Object.assign(state,{x:0,y:18,z:38,yaw:0,pitch:-.52,vy:0,onGround:false});syncSpectatorHud();}applyMatchState({...currentMatch});if(currentMatch.phase==='FINISHED')showMatchResult({reason:currentMatch.finishReason,winnerName:currentMatch.leaderName,standings:latestPlayers.map((player,index)=>({place:index+1,...player}))});updateLoading('正在等待服务器确认出生位置',96);await authoritativeEntry;updateLoading('部署完成',100);if(!matchFinished&&spectating)requestGamePointerLock();
    }catch(error){
      if(playing){playing=false;spectating=false;firing=false;$('hud').classList.add('hidden');$('spectatorHud').classList.add('hidden');$('menu').classList.remove('hidden');$('status').textContent=error.message||'进入房间失败';$('status').style.color='#ff647c';}
    }finally{setLoadingVisible(false);entryPending=false;}
  }
  function mapDescription(item){if(item.description)return item.description;return item.roomId==='arena'?'夜间工业设施 · 紧凑环线 · 中近距离交火':'白昼能源基地 · 多边形动线 · 高低差争夺';}
  async function refreshPublicStatus(){
    try{
      const response=await fetch('/api/status',{cache:'no-store'});if(!response.ok)return;const status=await response.json();
      $('publicStatusState').textContent=status.online>=status.connectionCapacity?'BUSY':'ONLINE';$('publicOnline').textContent=`${status.online||0} ONLINE · ${status.inBattle||0} IN BATTLE`;
      const byRoom=new Map((status.rooms||[]).map(room=>[room.roomId,room]));availableMaps=availableMaps.map(item=>({...item,...(byRoom.get(item.roomId)||{})}));
      document.querySelectorAll('.map-card').forEach(card=>{const room=byRoom.get(card.dataset.room);if(!room)return;card.classList.toggle('full',room.full);const node=card.querySelector('.map-card-capacity');if(node)node.textContent=`${room.players}/${room.capacity} PLAYERS${room.full?' · FULL':''}`;});
    }catch{}
  }
  function openMapSelection(asSpectator){
    if(!mapCompatible)return;refreshPublicStatus();const panel=$('mapSelection'),cards=$('mapCards');panel.dataset.entryMode=asSpectator?'spectate':'play';cards.innerHTML=availableMaps.map((item,index)=>`<button class="map-card${item.roomId===selectedRoomId?' active':''}${item.full?' full':''}" type="button" data-room="${escapeHtml(item.roomId)}"><img src="${escapeHtml(item.posterUrl||'')}" alt=""><span class="map-card-copy"><small>ZONE ${String(index+1).padStart(2,'0')}</small><strong>${escapeHtml(item.displayName||item.roomId)}</strong><span>${escapeHtml(mapDescription(item))}</span><em class="map-card-capacity">${item.players??0}/${item.capacity??'--'} PLAYERS${item.full?' · FULL':''}</em></span></button>`).join('');cards.querySelectorAll('.map-card').forEach(card=>card.onclick=()=>selectEntryMap(card.dataset.room,asSpectator));panel.classList.remove('hidden');
  }
  function selectEntryMap(roomId,asSpectator){
    const availability=availableMaps.find(item=>item.roomId===roomId);if(!asSpectator&&availability?.full){$('status').textContent=`Room is full (${availability.players}/${availability.capacity})`;$('status').style.color='#ffb45e';return;}
    if(roomId===selectedRoomId){$('mapSelection').classList.add('hidden');enterGame(asSpectator);return;}
    const metadata=availableMaps.find(item=>item.roomId===roomId);preloadLoadingPoster(metadata);$('mapSelection').classList.add('hidden');$('menu').classList.add('hidden');loadingValue=8;loadingDisplayValue=8;setLoadingVisible(true);updateLoading('正在切换作战区域',12);localStorage.setItem('neonArenaRoom',roomId);sessionStorage.setItem('zeroPendingEntryMode',asSpectator?'spectate':'play');const url=new URL(location.href);url.searchParams.set('room',roomId);setTimeout(()=>{location.href=url.toString();},120);
  }
  $('mapSelectionBack').onclick=()=>$('mapSelection').classList.add('hidden');$('play').onclick=()=>openMapSelection(false);$('spectate').onclick=()=>openMapSelection(true);$('spectatorPrevious').onclick=()=>selectSpectatorTarget(-1);$('spectatorNext').onclick=()=>selectSpectatorTarget(1);$('spectatorMode').onclick=()=>setSpectatorMode(spectatorMode==='FREE'?'FOLLOW':'FREE');$('spectatorExit').onclick=quitGame;
  function selectSpawnBuff(buff){if(buffSelectionPending||performance.now()>=buffSelectionDeadline)return;const button=document.querySelector(`#buffSelection [data-buff="${buff}"]`);if(!button)return;buffSelectionPending=true;document.querySelectorAll('#buffSelection [data-buff]').forEach(item=>item.disabled=true);send({type:'select_spawn_buff',buff});requestGamePointerLock();}
  document.querySelectorAll('#buffSelection [data-buff]').forEach(button=>button.onclick=()=>selectSpawnBuff(button.dataset.buff));
  canvas.onclick=()=>{if(playing&&!dead&&!matchFinished)requestGamePointerLock();};
  addEventListener('keydown',event=>{
    if(!$('buffSelection').classList.contains('hidden')){
      const buffByKey={Digit1:'NO_AMMO',Digit2:'LEFT_TRAJECTORY',Digit3:'FEARLESS',Digit0:'NONE',Numpad1:'NO_AMMO',Numpad2:'LEFT_TRAJECTORY',Numpad3:'FEARLESS',Numpad0:'NONE'};
      if(buffByKey[event.code]){selectSpawnBuff(buffByKey[event.code]);event.preventDefault();return;}
    }
    if(event.code==='Escape'){if(!$('mapSelection').classList.contains('hidden'))$('mapSelection').classList.add('hidden');else if(!$('chatInput').classList.contains('hidden')){$('chatInput').classList.add('hidden');requestGamePointerLock();}else if(settingsOpen)setSettingsOpen(false);else if(playing)setSettingsOpen(true);event.preventDefault();return;}
    if(settingsOpen){event.preventDefault();return;}
    if(event.code==='KeyT'&&playing){event.preventDefault();setSettingsOpen(true);return;}
    keys[event.code]=true;
    if(spectating){if(event.code==='KeyF'){event.preventDefault();setSpectatorMode(spectatorMode==='FREE'?'FOLLOW':'FREE');}if(event.code==='BracketLeft'){event.preventDefault();selectSpectatorTarget(-1);}if(event.code==='BracketRight'){event.preventDefault();selectSpectatorTarget(1);}}
    else{if(event.code==='Space'&&state.onGround){state.vy=me?.speedBoostActive?11.25:8;state.onGround=false;jumpRequested=true;}if(/^Digit[1-3]$/.test(event.code)){const selected=weaponController.weaponForDigit(event.code,ownedWeapons,weapon);if(selected)setWeapon(selected);}if(event.code==='Digit4'){event.preventDefault();equipThrowable();}if(event.code==='KeyR')reload();if(event.code==='KeyG'){event.preventDefault();equipThrowable();}}
    if(event.code==='Tab'){event.preventDefault();$('board').classList.remove('hidden');}
    if(event.code==='KeyY'){event.preventDefault();keys.KeyY=false;const input=$('chatInput');input.classList.remove('hidden');input.focus();releaseGamePointerLock();}
  });
  addEventListener('keyup',event=>{keys[event.code]=false;if(event.code==='Tab')$('board').classList.add('hidden');});
  ['contextmenu','auxclick','dragstart'].forEach(type=>document.addEventListener(type,event=>{if(playing)event.preventDefault();},{capture:true}));
  // mousedown 在左右键同时按下时仍会逐键触发；pointerdown 只报告第一个按键，会导致右键开镜后左键失效。
  canvas.addEventListener('mousedown',event=>{if(spectating)return;if(event.button===0&&document.pointerLockElement===canvas){if(throwableEquipped){startGrenadePrime();return;}if(!(sniperAimFireMode==='AIM_RELEASE'&&WEAPONS[weapon]?.category==='SNIPER_RIFLE'))shoot();if(weaponController.isAutomatic(weapon)){firing=true;automaticFireAt=performance.now()+180;}}if(event.button===2){event.preventDefault();if(throwableEquipped)return;scope(true);}});addEventListener('mouseup',event=>{if(event.button===0){firing=false;if(grenadePriming)releaseGrenadePrime();}if(event.button===2&&!spectating){event.preventDefault();if(throwableEquipped)return;if(sniperAimFireMode==='AIM_RELEASE'&&WEAPONS[weapon]?.category==='SNIPER_RIFLE'&&aimProgress>=.72)shoot();scope(false);}});addEventListener('blur',()=>{firing=false;grenadePriming=false;syncCrosshairVisibility();});
  $('chatInput').addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'){send({type:'chat',text:event.target.value});event.target.value='';event.target.classList.add('hidden');requestGamePointerLock();}if(event.key==='Escape'){event.target.classList.add('hidden');requestGamePointerLock();}});
  addEventListener('mousemove',event=>{if(document.pointerLockElement===canvas&&!dead&&!settingsOpen&&!matchFinished){const sensitivity=.0022*appSettings.controls.mouseSensitivity*(scoped?appSettings.controls.scopeSensitivity:1);state.yaw-=event.movementX*sensitivity;state.pitch=Math.max(-1.45,Math.min(1.45,state.pitch-event.movementY*sensitivity));}});
  // 浏览器按 Esc 退出 Pointer Lock 时可能不派发 Escape keydown，使用状态变化事件补齐设置入口。
  document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement===canvas){suppressPointerUnlock=false;return;}if(suppressPointerUnlock){suppressPointerUnlock=false;return;}const onboardingVisible=!$('buffSelection').classList.contains('hidden');if(playing&&!settingsOpen&&!dead&&!matchFinished&&!onboardingVisible&&$('chatInput').classList.contains('hidden'))setSettingsOpen(true);});
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();viewModelCamera.aspect=camera.aspect;viewModelCamera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
  let previous=performance.now(),fpsWindowStarted=previous,fpsFrames=0,longFrames=0,slowWindows=0,nextHudAt=0,nextVisibilityAt=0,performanceGraceUntil=Infinity;
  function animate(time){
    requestAnimationFrame(animate);const frameMs=time-previous,dt=Math.min(.05,frameMs/1000);previous=time;fpsFrames++;frameSamples.push(frameMs);if(frameSamples.length>600)frameSamples.shift();if(frameMs>42)longFrames++;
    if(time-fpsWindowStarted>=1000){measuredFps=Math.round(fpsFrames*1000/(time-fpsWindowStarted));const sorted=[...frameSamples].sort((a,b)=>a-b);p99FrameMs=sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.99))]:0;onePercentLow=p99FrameMs?Math.round(1000/p99FrameMs):0;const struggling=time>=performanceGraceUntil&&(measuredFps<44||p99FrameMs>34||longFrames>=6);slowWindows=struggling?slowWindows+1:0;if(slowWindows>=3&&qualityName!=='low'){const next=qualityName==='high'?'medium':'low';applyQuality(next);chat(`Performance protection switched to ${next.toUpperCase()} quality.`,true);slowWindows=0;}$('devStats').innerHTML=`${serverStats}<br>FPS ${measuredFps} · 1%L ${onePercentLow} · P99 ${p99FrameMs.toFixed(1)}ms · DRAW ${renderer.info.render.calls}`;publishPerformanceSnapshot(longFrames);fpsFrames=0;longFrames=0;correctionCount=0;correctionDistance=0;fpsWindowStarted=time;}
    tick(dt);if(firing&&time>=automaticFireAt)shoot();tryPickup();updateAim(dt);if(time>=nextHudAt){updateHud();updateMatchHud();nextHudAt=time+100;}updateBuffSelection();updateWeaponView(time,dt);updateVisualParticles(dt);updateVisualTracers(time);updateExplosionLights(performance.now());updateGrenadeVisuals(dt);updateSmokeVisuals(time);if(time>=nextVisibilityAt){mapVisualLoader?.updateVisibility(camera.position);nextVisibilityAt=time+180;}
    Object.values(pickupMeshes).forEach((mesh,index)=>{if(mesh.visible){mesh.rotation.y+=dt*(1.2+index*.1);mesh.position.y=(mesh.userData.hoverBaseY??1.1)+Math.sin(time*.002+index)*.15;}});const remoteBlend=1-Math.exp(-12*dt);remote.forEach((object,playerId)=>{
      if(object.userData.target)object.position.lerp(object.userData.target,remoteBlend);object.rotation.y+=(object.userData.yaw-object.rotation.y)*remoteBlend;
      const visual=object.userData.visualRoot,deathElapsed=object.userData.deathStartedAt?time-object.userData.deathStartedAt:Infinity,deathAnimating=!object.userData.wasAlive&&deathElapsed<850;
      if(deathAnimating&&visual){const normalized=THREE.MathUtils.clamp(deathElapsed/700,0,1),eased=normalized*normalized*(3-2*normalized);visual.rotation.z=(object.userData.deathDirection||1)*1.34*eased;visual.rotation.x=-.16*eased;visual.position.y=-.48*eased;}
      object.visible=(object.userData.wasAlive||deathAnimating)&&!(spectating&&spectatorMode==='FOLLOW'&&spectatorTargetId===playerId);
    });renderer.clear();renderer.render(scene,camera);if(!spectating){renderer.clearDepth();renderer.render(viewModelScene,viewModelCamera);}markAuthoritativeEntryFrameRendered();
  }
  refreshPublicStatus();connect();setInterval(()=>send({type:'ping',clientTime:Date.now()}),2000);setInterval(refreshPublicStatus,5000);animate(previous);
})();
