(function(global){
  'use strict';

  function radialTexture(THREE,inner,middle,outer){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=96;
    const context=canvas.getContext('2d'),gradient=context.createRadialGradient(48,48,2,48,48,46);
    gradient.addColorStop(0,inner);gradient.addColorStop(.28,middle);gradient.addColorStop(1,outer);
    context.fillStyle=gradient;context.fillRect(0,0,96,96);
    return new THREE.CanvasTexture(canvas);
  }

  /**
   * Shared low-poly muzzle effect used by both the game and the developer studio.
   * The owner controls root/light placement; this object owns flash timing and
   * transient smoke/spark particles so both surfaces render the same result.
   */
  function createMuzzleEffect(options){
    const THREE=options.THREE,scene=options.scene,isSniper=!!options.isSniper;
    const quality=options.quality||(()=> 'medium'),particles=[];
    const flashTexture=radialTexture(THREE,'rgba(255,255,225,1)','rgba(255,185,70,.88)','rgba(255,70,8,0)');
    const smokeTexture=radialTexture(THREE,'rgba(220,230,238,.55)','rgba(135,145,155,.28)','rgba(70,80,90,0)');
    const root=new THREE.Group();root.name='SharedMuzzleFlash';root.visible=false;
    const core=new THREE.Sprite(new THREE.SpriteMaterial({map:flashTexture,color:isSniper?0xffb34a:0xffe18a,transparent:true,opacity:.86,depthTest:false,depthWrite:false}));
    core.scale.set(isSniper?.34:.26,isSniper?.24:.18,1);root.add(core);
    const rays=[];
    for(let index=0;index<4;index++){
      const ray=new THREE.Mesh(new THREE.ConeGeometry(.035,.32,6),new THREE.MeshBasicMaterial({color:index%2?0xff9a32:0xffd15a,transparent:true,opacity:.52,depthTest:false,depthWrite:false}));
      ray.rotation.x=-Math.PI/2;ray.rotation.z=index*Math.PI/2+Math.PI/4;ray.position.z=-.14;rays.push(ray);root.add(ray);
    }
    const light=new THREE.PointLight(isSniper?0xff9b36:0xffc35a,0,3.2);
    let flashRemaining=0;

    function disposeParticle(item){
      scene.remove(item.object);item.object.geometry?.dispose();item.object.material?.dispose();
    }
    function spawnParticles(effects){
      const origin=new THREE.Vector3();
      const low=quality()==='low',smokeCount=effects.smokeCount??3,sparkCount=effects.sparkCount??4;
      root.getWorldPosition(origin);
      for(let index=0;index<(low?Math.min(1,smokeCount):smokeCount);index++){
        const smoke=new THREE.Sprite(new THREE.SpriteMaterial({map:smokeTexture,color:0xcbd8e3,transparent:true,opacity:.32,depthWrite:false}));
        smoke.position.copy(origin);smoke.scale.setScalar(.055+Math.random()*.045);scene.add(smoke);
        particles.push({object:smoke,life:.22+Math.random()*.12,maxLife:.34,velocity:new THREE.Vector3((Math.random()-.5)*.14,.12+Math.random()*.10,(Math.random()-.5)*.14),smoke:true});
      }
      for(let index=0;index<(low?Math.min(1,sparkCount):sparkCount);index++){
        const colors=effects.sparkColors||[0xffb23f,0xffe3a1],spark=new THREE.Mesh(new THREE.SphereGeometry(.006+Math.random()*.003,4,3),new THREE.MeshBasicMaterial({color:colors[index%colors.length],transparent:true,opacity:.95,depthWrite:false}));
        spark.position.copy(origin);scene.add(spark);
        particles.push({object:spark,life:.06+Math.random()*.05,maxLife:.11,velocity:new THREE.Vector3((Math.random()-.5)*.55,(Math.random()-.25)*.42,-.35-Math.random()*.55),spark:true});
      }
    }
    function trigger(effects={}){
      const scale=effects.muzzleScale||{min:.58,variance:.34};
      const coreScale=effects.coreScale||(isSniper?[.34,.24]:[.26,.18]),outerColors=effects.outerColors||[0xffd15a,0xff9a32];
      core.scale.set(coreScale[0],coreScale[1],1);core.material.color.set(effects.coreColor??(isSniper?0xffb34a:0xffe18a));core.material.opacity=effects.coreOpacity??.86;
      rays.forEach((ray,index)=>{ray.material.color.set(outerColors[index%outerColors.length]);ray.material.opacity=effects.rayOpacity??.52;ray.scale.set(effects.rayWidthScale??1,effects.rayLengthScale??1,effects.rayWidthScale??1);});
      root.rotation.z+=Math.random()*Math.PI;root.scale.setScalar(scale.min+Math.random()*scale.variance);root.visible=true;
      light.color.set(effects.lightColor??(isSniper?0xff9b36:0xffc35a));light.distance=effects.muzzleLightDistance??3.2;light.intensity=effects.muzzleLight??4.5;
      flashRemaining=(effects.durationMs??55)/1000;spawnParticles(effects);
    }
    function update(dt){
      flashRemaining=Math.max(0,flashRemaining-dt);if(flashRemaining===0)root.visible=false;
      light.intensity*=Math.pow(.0001,dt);
      for(let index=particles.length-1;index>=0;index--){
        const item=particles[index],object=item.object;item.life-=dt;
        if(item.life<=0){disposeParticle(item);particles.splice(index,1);continue;}
        object.position.addScaledVector(item.velocity,dt);const ratio=item.life/item.maxLife;
        if(item.smoke){object.material.opacity=Math.max(0,ratio*.32);object.scale.multiplyScalar(1+dt*2.5);}
        else{object.material.opacity=Math.max(0,ratio);object.scale.setScalar(Math.max(.15,ratio));}
      }
    }
    function dispose(){particles.splice(0).forEach(disposeParticle);flashTexture.dispose();smokeTexture.dispose();root.traverse(node=>{node.geometry?.dispose();node.material?.dispose();});}
    return{root,light,trigger,update,dispose};
  }

  global.WeaponPreviewRuntime={createMuzzleEffect};
})(window);
