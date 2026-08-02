(function (global) {
  'use strict';

  const CONTRACT_VERSION = 1;

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function finiteVector(value, length, path, fallback) {
    if (value == null && fallback) return fallback.slice();
    assert(Array.isArray(value) && value.length === length, `${path} must contain ${length} numbers`);
    value.forEach((part, index) => assert(Number.isFinite(part), `${path}[${index}] must be finite`));
    return value.slice();
  }

  function validateManifest(source) {
    assert(source && typeof source === 'object' && !Array.isArray(source), 'Prefab manifest must be an object');
    assert(source.contractVersion === CONTRACT_VERSION,
      `Unsupported prefab manifest contractVersion: ${source.contractVersion}`);
    const prefabs = {};
    Object.entries(source.prefabs || {}).forEach(([id, raw]) => {
      const path = `prefabs.${id}`;
      assert(/^[a-z0-9][a-z0-9/_-]*$/.test(id), `${path} has an invalid id`);
      assert(raw && typeof raw === 'object' && !Array.isArray(raw), `${path} must be an object`);
      assert(typeof raw.url === 'string' && raw.url.trim(), `${path}.url is required`);
      assert(raw.node == null || typeof raw.node === 'string', `${path}.node must be a string`);
      const variants = {};
      Object.entries(raw.variants || {}).forEach(([variantId, variant]) => {
        assert(variant && typeof variant === 'object' && !Array.isArray(variant),
          `${path}.variants.${variantId} must be an object`);
        const materials = Array.isArray(variant.materials) ? variant.materials.map((entry, index) => {
          const itemPath = `${path}.variants.${variantId}.materials[${index}]`;
          assert(entry && typeof entry.material === 'string' && entry.material.trim(),
            `${itemPath}.material is required`);
          ['roughness', 'metalness', 'emissiveIntensity'].forEach(key => {
            if (entry[key] != null) assert(Number.isFinite(entry[key]), `${itemPath}.${key} must be finite`);
          });
          return {...entry};
        }) : [];
        variants[variantId] = {materials};
      });
      prefabs[id] = {url: raw.url.trim(), node: raw.node || null, variants};
    });
    return {contractVersion: CONTRACT_VERSION, prefabs};
  }

  function validateVisuals(source, manifest, colliderIds) {
    assert(Array.isArray(source), 'Map visuals must be an array');
    const knownColliders = colliderIds ? new Set(colliderIds) : null;
    const ids = new Set();
    return source.map((raw, index) => {
      const path = `visuals[${index}]`;
      assert(raw && typeof raw === 'object' && !Array.isArray(raw), `${path} must be an object`);
      const id = String(raw.id || '').trim();
      assert(id && !ids.has(id), `${path}.id must be unique`);
      ids.add(id);
      const prefab = String(raw.prefab || '').trim();
      assert(manifest.prefabs[prefab], `${path}.prefab references unknown prefab: ${prefab}`);
      const position = finiteVector(raw.position, 3, `${path}.position`, [0, 0, 0]);
      assert(raw.rotationY == null || Number.isFinite(raw.rotationY), `${path}.rotationY must be finite`);
      const scale = Number.isFinite(raw.scale) ? [raw.scale, raw.scale, raw.scale] :
        finiteVector(raw.scale, 3, `${path}.scale`, [1, 1, 1]);
      scale.forEach((part, partIndex) => assert(part > 0, `${path}.scale[${partIndex}] must be positive`));
      const variant = raw.variant == null ? null : String(raw.variant);
      assert(variant == null || manifest.prefabs[prefab].variants[variant],
        `${path}.variant references unknown variant: ${variant}`);
      const colliderRefs = raw.colliderRefs == null ? [] : raw.colliderRefs;
      assert(Array.isArray(colliderRefs), `${path}.colliderRefs must be an array`);
      colliderRefs.forEach((ref, refIndex) => {
        assert(typeof ref === 'string' && ref, `${path}.colliderRefs[${refIndex}] must be a string`);
        if (knownColliders) assert(knownColliders.has(ref), `${path}.colliderRefs[${refIndex}] references unknown collider: ${ref}`);
      });
      const cullDistance = raw.cullDistance == null ? null : Number(raw.cullDistance);
      assert(cullDistance == null || Number.isFinite(cullDistance) && cullDistance > 0,
        `${path}.cullDistance must be positive`);
      // 承载碰撞轮廓的外壳不能按距离消失，否则远处玩家会看到“空气墙”。距离裁剪仅用于灯具、标牌等纯装饰。
      assert(cullDistance == null || colliderRefs.length === 0,
        `${path}.cullDistance is only allowed for visuals without colliderRefs`);
      return {id, prefab, position, rotationY: raw.rotationY || 0, scale,
        variant, colliderRefs: colliderRefs.slice(), cullDistance};
    });
  }

  function loadGltf(loader, url) {
    if (typeof loader.loadAsync === 'function') return loader.loadAsync(url);
    return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
  }

  function setColor(target, value) {
    if (value == null || !target?.set) return;
    target.set(value);
  }

  /**
   * Object3D.clone(true) 会复用几何体、纹理和材质。几何体与纹理共享正是我们降低内存占用所需要的，
   * 但材质若继续共享，一个区域的配色变体会污染所有实例。因此只克隆材质，纹理引用仍由 clone() 保留。
   */
  function isolateMaterials(root) {
    root.traverse(object => {
      if (!object.isMesh || !object.material) return;
      object.material = Array.isArray(object.material) ?
        object.material.map(material => material.clone()) : object.material.clone();
    });
    return root;
  }

  function applyVariant(root, variant) {
    if (!variant?.materials?.length) return;
    const changes = new Map(variant.materials.map(entry => [entry.material, entry]));
    root.traverse(object => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        const change = changes.get(material.name);
        if (!change) return;
        setColor(material.color, change.color);
        setColor(material.emissive, change.emissive);
        for (const key of ['roughness', 'metalness', 'emissiveIntensity']) {
          if (change[key] != null && key in material) material[key] = change[key];
        }
        material.needsUpdate = true;
      });
    });
  }

  /**
   * 灰盒仍负责碰撞和客户端旧协议射线回退，所以这里只关闭材质绘制，不移除 Object3D。
   * Prefab 加载失败时本方法不会执行，玩家永远不会看到“资源失败后整个掩体消失”的空地图。
   */
  function hideGraybox(mesh) {
    if (!mesh?.traverse) return;
    mesh.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach(material => { material.visible = false; });
    });
    mesh.userData.prefabReplaced = true;
  }

  function create(options) {
    const THREE = options?.THREE;
    const scene = options?.scene;
    const loader = options?.loader;
    const grayboxes = options?.grayboxes || new Map();
    const warn = options?.warn || ((...args) => console.warn(...args));
    assert(THREE && scene && loader, 'MapVisualRuntime requires THREE, scene and loader');
    const assetLoads = new Map();
    const liveInstances = [];

    function asset(url) {
      if (!assetLoads.has(url)) assetLoads.set(url, loadGltf(loader, url));
      return assetLoads.get(url);
    }

    async function instantiate(prefab, visual, baseUrl) {
      const url = new URL(prefab.url, baseUrl).href;
      const gltf = await asset(url);
      const source = prefab.node ? gltf.scene.getObjectByName(prefab.node) : gltf.scene;
      if (!source) throw new Error(`GLB node not found: ${prefab.node}`);
      const instance = isolateMaterials(source.clone(true));
      instance.name = visual.id;
      instance.position.fromArray(visual.position);
      instance.rotation.y = visual.rotationY;
      instance.scale.fromArray(visual.scale);
      instance.userData.mapVisualId = visual.id;
      instance.userData.prefabId = visual.prefab;
      instance.userData.cullDistance = visual.cullDistance;
      applyVariant(instance, visual.variant ? prefab.variants[visual.variant] : null);
      scene.add(instance);
      liveInstances.push(instance);
      visual.colliderRefs.forEach(id => hideGraybox(grayboxes.get(id)));
      return instance;
    }

    async function load(manifestUrl, rawVisuals, fetchImpl) {
      if (!rawVisuals?.length) return {instances: [], loaded: 0, failed: 0, assetCount: 0};
      const fetcher = fetchImpl || global.fetch;
      assert(typeof fetcher === 'function', 'fetch is required to load the prefab manifest');
      const response = await fetcher(manifestUrl, {cache: 'no-cache'});
      if (!response.ok) throw new Error(`Prefab manifest HTTP ${response.status}`);
      const manifest = validateManifest(await response.json());
      const visuals = validateVisuals(rawVisuals, manifest, grayboxes.keys());
      const baseUrl = response.url || new URL(manifestUrl, global.location?.href || 'http://localhost/').href;
      // 不同 GLB 并发下载；相同 URL 仍由 assetLoads 共享一个 Promise。每个实例自行捕获失败，
      // 因此单个装饰损坏不会让 Promise.all 拒绝，也不会影响其他碰撞灰盒的回退显示。
      const results = await Promise.all(visuals.map(async visual => {
        try {
          return await instantiate(manifest.prefabs[visual.prefab], visual, baseUrl);
        } catch (error) {
          warn(`Map prefab ${visual.id} failed; keeping graybox`, error);
          return null;
        }
      }));
      const instances = results.filter(Boolean);
      const failed = results.length - instances.length;
      return {instances, loaded: instances.length, failed, assetCount: assetLoads.size};
    }

    /**
     * 纯装饰 Prefab 使用平方距离裁剪，避免每帧开平方。结构外壳的 cullDistance 永远为空，
     * 所以它们不会因画质或观察距离变化而破坏地图可读性。
     */
    function updateVisibility(cameraPosition) {
      if (!cameraPosition) return;
      liveInstances.forEach(instance => {
        const distance = instance.userData.cullDistance;
        if (distance == null) return;
        const dx=instance.position.x-cameraPosition.x,dy=instance.position.y-cameraPosition.y,dz=instance.position.z-cameraPosition.z;
        instance.visible=dx*dx+dy*dy+dz*dz<=distance*distance;
      });
    }

    return {load, instantiate, updateVisibility, assetLoads, liveInstances};
  }

  global.MapVisualRuntime = {CONTRACT_VERSION, validateManifest, validateVisuals,
    isolateMaterials, applyVariant, hideGraybox, create};
})(typeof window !== 'undefined' ? window : globalThis);
