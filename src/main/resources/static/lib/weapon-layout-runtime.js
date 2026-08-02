(function (global) {
  'use strict';

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  /**
   * 合并清单默认值与独立布局。muzzleBinding 必须深合并，避免只覆盖部分字段时
   * 丢失绑定模式或节点名，导致保存前后表现不一致。
   */
  function merge(base, layout) {
    const result = {...(base || {}), ...(layout || {})};
    if (base?.muzzleBinding || layout?.muzzleBinding) {
      result.muzzleBinding = {...(base?.muzzleBinding || {}), ...(layout?.muzzleBinding || {})};
    }
    return result;
  }

  function binding(config) {
    const configured = config?.muzzleBinding;
    if (configured?.mode === 'NODE') {
      return {mode: 'NODE', node: configured.node || config?.nodes?.muzzle,
        offset: clone(configured.offset || [0, 0, 0]), rotationOffset: clone(configured.rotationOffset || [0, 0, 0])};
    }
    if (configured?.mode === 'VIEW') {
      return {mode: 'VIEW', position: clone(configured.position || [0, 0, -1]),
        rotation: clone(configured.rotation || [0, 0, 0])};
    }
    throw new Error('Weapon view model requires muzzleBinding.mode NODE or VIEW');
  }

  /** 解析命名枪口预设，再叠加单武器覆盖项；casing 等非视觉参数也支持局部覆盖。 */
  function resolveEffects(weaponContract, viewConfig) {
    const profileName = viewConfig?.muzzleProfile;
    if (profileName && !weaponContract?.muzzleProfiles?.[profileName]) {
      throw new Error(`Unknown muzzle profile: ${profileName}`);
    }
    const profile = weaponContract?.muzzleProfiles?.[profileName] || {};
    const overrides = viewConfig?.muzzleOverrides || {};
    const legacy = viewConfig?.effects || {};
    const result = {...profile, ...overrides, ...legacy};
    // 布局文件允许只覆盖数组或对象中的一个值。这里按成员合并，避免只调整
    // coreScale.x 时把预设中的 coreScale.y 一并覆盖掉。
    for (const key of ['muzzleScale']) {
      if (profile[key] || overrides[key] || legacy[key]) {
        result[key] = {...(profile[key] || {}), ...(overrides[key] || {}), ...(legacy[key] || {})};
      }
    }
    for (const key of ['coreScale', 'outerColors']) {
      const sources = [profile[key], overrides[key], legacy[key]];
      if (sources.some(Array.isArray)) {
        const length = Math.max(...sources.filter(Array.isArray).map(value => value.length));
        result[key] = Array.from({length}, (_, index) => {
          for (let source = sources.length - 1; source >= 0; source--) {
            if (sources[source]?.[index] != null) return sources[source][index];
          }
          return undefined;
        });
      }
    }
    if (profile.casing || overrides.casing || legacy.casing) {
      result.casing = {...(profile.casing || {}), ...(overrides.casing || {}), ...(legacy.casing || {})};
    }
    return result;
  }

  /** 冷加载与热更新共用的静态布局应用逻辑。 */
  function applyLayout({asset, view, armWrapper, config}) {
    if (Number.isFinite(Number(config.scale))) asset.scale.setScalar(Number(config.scale));
    if (Array.isArray(config.axisRotation)) asset.rotation.fromArray(config.axisRotation);
    if (Array.isArray(config.viewPosition)) (view.userData?.basePosition || view.position).fromArray(config.viewPosition);
    if (Array.isArray(config.viewRotation)) (view.userData?.baseRotation || view.rotation).fromArray(config.viewRotation);
    if (armWrapper) {
      armWrapper.position.fromArray(config.armOffset || [0, 0, 0]);
      armWrapper.rotation.fromArray(config.armRotation || [0, 0, 0]);
    }
    Object.entries(config.pivotPositions || {}).forEach(([name, value]) => {
      const node = asset.getObjectByName(name); if (node && Array.isArray(value)) node.position.fromArray(value);
    });
    Object.entries(config.pivotRotations || {}).forEach(([name, value]) => {
      const node = asset.getObjectByName(name); if (node && Array.isArray(value)) node.rotation.fromArray(value);
    });
  }

  /**
   * NODE 模式把虚拟挂点放到 GLB 节点下，动画自然带动它；VIEW 模式使用固定视图坐标。
   * 重复应用时复用挂点，避免每次热更新都向模型场景树添加对象。
   */
  function resolveMuzzle({THREE, asset, config, existingAttachment}) {
    const value = binding(config);
    if (value.mode === 'VIEW') {
      if (existingAttachment?.parent) existingAttachment.parent.remove(existingAttachment);
      return {binding: value, attachment: null};
    }
    const node = asset.getObjectByName(value.node);
    if (!node) throw new Error(`Muzzle node not found: ${value.node}`);
    let attachment = existingAttachment;
    if (!attachment || attachment.parent !== node) {
      if (attachment?.parent) attachment.parent.remove(attachment);
      attachment = new THREE.Group();
      attachment.name = 'RuntimeMuzzleBinding'; node.add(attachment);
    }
    attachment.position.fromArray(value.offset);
    attachment.rotation.fromArray(value.rotationOffset);
    return {binding: value, attachment};
  }

  function layoutPayload({identity, profile, muzzleProfile, muzzleOverrides, asset, view, armWrapper, pivots, muzzleBinding}) {
    const values = object => [object.x, object.y, object.z].map(number => +Number(number).toFixed(6));
    const result = {weaponId: identity.id, weaponCode: identity.code, profile, muzzleProfile, muzzleOverrides: clone(muzzleOverrides || {}),
      scale: +Number(asset.scale.x).toFixed(6), axisRotation: values(asset.rotation),
      viewPosition: values(view.position), viewRotation: values(view.rotation), muzzleBinding: clone(muzzleBinding)};
    if (armWrapper) { result.armOffset = values(armWrapper.position); result.armRotation = values(armWrapper.rotation); }
    if (pivots?.left && pivots?.right) {
      result.pivotPositions = {LeftArmPivot: values(pivots.left.position), RightArmPivot: values(pivots.right.position)};
      result.pivotRotations = {LeftArmPivot: values(pivots.left.rotation), RightArmPivot: values(pivots.right.rotation)};
    }
    return result;
  }

  global.WeaponLayoutRuntime = {merge, binding, resolveEffects, applyLayout, resolveMuzzle, layoutPayload};
})(window);
