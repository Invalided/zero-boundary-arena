(function (global) {
  'use strict';

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const LIMITS = Object.freeze({
    materialCount: 12,
    durationMs: [35, 100],
    sparkCount: [0, 8],
    smokeCount: [0, 5],
    muzzleLight: [0, 8],
    muzzleLightDistance: [0, 4],
    muzzleScaleMin: [0.005, 1.2],
    muzzleScaleVariance: [0, 0.6],
    coreScale: [0.02, 1.2]
  });

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function numberInRange(value, range, path) {
    assert(Number.isFinite(value) && value >= range[0] && value <= range[1],
      `${path} must be between ${range[0]} and ${range[1]}`);
    return value;
  }

  function color(value, path) {
    assert(Number.isInteger(value) && value >= 0 && value <= 0xffffff,
      `${path} must be an RGB integer`);
    return value;
  }

  function validateMaterials(materials, path) {
    if (materials == null) return [];
    assert(Array.isArray(materials) && materials.length <= LIMITS.materialCount,
      `${path} supports at most ${LIMITS.materialCount} entries`);
    return materials.map((entry, index) => {
      const itemPath = `${path}[${index}]`;
      assert(entry && typeof entry === 'object' && typeof entry.material === 'string' && entry.material.trim(),
        `${itemPath}.material is required`);
      const allowed = new Set(['material', 'color', 'roughness', 'metalness']);
      Object.keys(entry).forEach(key => assert(allowed.has(key), `${itemPath}.${key} is not allowed`));
      const result = {material: entry.material.trim()};
      if (entry.color != null) result.color = color(entry.color, `${itemPath}.color`);
      if (entry.roughness != null) result.roughness = numberInRange(entry.roughness, [0, 1], `${itemPath}.roughness`);
      if (entry.metalness != null) result.metalness = numberInRange(entry.metalness, [0, 1], `${itemPath}.metalness`);
      assert(Object.keys(result).length > 1, `${itemPath} does not contain a material change`);
      return result;
    });
  }

  /**
   * 皮肤只能覆盖视觉白名单。这里主动拒绝未知字段，避免未来误把伤害、射速等
   * 战斗数值塞进皮肤配置，也防止过亮、过久的特效遮挡其他玩家视野。
   */
  function validateMuzzle(muzzle, manifest, path) {
    if (muzzle == null) return null;
    assert(muzzle && typeof muzzle === 'object', `${path} must be an object`);
    const allowedRoot = new Set(['profile', 'overrides']);
    Object.keys(muzzle).forEach(key => assert(allowedRoot.has(key), `${path}.${key} is not allowed`));
    const result = {};
    if (muzzle.profile != null) {
      assert(typeof muzzle.profile === 'string' && manifest?.muzzleProfiles?.[muzzle.profile],
        `${path}.profile references an unknown muzzle profile`);
      result.profile = muzzle.profile;
    }
    const values = muzzle.overrides;
    if (values != null) {
      assert(values && typeof values === 'object' && !Array.isArray(values), `${path}.overrides must be an object`);
      const allowed = new Set(['coreScale', 'coreColor', 'outerColors', 'lightColor', 'durationMs',
        'sparkCount', 'smokeCount', 'muzzleLight', 'muzzleLightDistance', 'muzzleScale']);
      Object.keys(values).forEach(key => assert(allowed.has(key), `${path}.overrides.${key} is not allowed`));
      const overrides = {};
      if (values.coreScale != null) {
        assert(Array.isArray(values.coreScale) && values.coreScale.length === 2, `${path}.overrides.coreScale must contain 2 numbers`);
        overrides.coreScale = values.coreScale.map((value, index) => numberInRange(value, LIMITS.coreScale,
          `${path}.overrides.coreScale[${index}]`));
      }
      if (values.coreColor != null) overrides.coreColor = color(values.coreColor, `${path}.overrides.coreColor`);
      if (values.outerColors != null) {
        assert(Array.isArray(values.outerColors) && values.outerColors.length === 2,
          `${path}.overrides.outerColors must contain 2 colors`);
        overrides.outerColors = values.outerColors.map((value, index) => color(value, `${path}.overrides.outerColors[${index}]`));
      }
      if (values.lightColor != null) overrides.lightColor = color(values.lightColor, `${path}.overrides.lightColor`);
      for (const [key, range] of [['durationMs', LIMITS.durationMs], ['sparkCount', LIMITS.sparkCount],
        ['smokeCount', LIMITS.smokeCount], ['muzzleLight', LIMITS.muzzleLight],
        ['muzzleLightDistance', LIMITS.muzzleLightDistance]]) {
        if (values[key] != null) overrides[key] = numberInRange(values[key], range, `${path}.overrides.${key}`);
      }
      for (const key of ['durationMs', 'sparkCount', 'smokeCount']) {
        if (overrides[key] != null) assert(Number.isInteger(overrides[key]), `${path}.overrides.${key} must be an integer`);
      }
      if (values.muzzleScale != null) {
        const scale = values.muzzleScale;
        assert(scale && typeof scale === 'object' && !Array.isArray(scale), `${path}.overrides.muzzleScale must be an object`);
        const scaleAllowed = new Set(['min', 'variance']);
        Object.keys(scale).forEach(key => assert(scaleAllowed.has(key), `${path}.overrides.muzzleScale.${key} is not allowed`));
        overrides.muzzleScale = {};
        if (scale.min != null) overrides.muzzleScale.min = numberInRange(scale.min, LIMITS.muzzleScaleMin,
          `${path}.overrides.muzzleScale.min`);
        if (scale.variance != null) overrides.muzzleScale.variance = numberInRange(scale.variance,
          LIMITS.muzzleScaleVariance, `${path}.overrides.muzzleScale.variance`);
      }
      result.overrides = overrides;
    }
    return result;
  }

  function validateSkin(skinId, skin, manifest) {
    const path = `skins.${skinId}`;
    assert(UUID_PATTERN.test(skinId), `${path} key must be a UUID`);
    assert(skin?.identity?.id === skinId, `${path}.identity.id must match its catalog key`);
    assert(typeof skin.identity.code === 'string' && skin.identity.code.trim(), `${path}.identity.code is required`);
    assert(typeof skin.identity.displayName === 'string' && skin.identity.displayName.trim(), `${path}.identity.displayName is required`);
    const compatibility = skin.compatibility;
    assert(compatibility && typeof compatibility === 'object', `${path}.compatibility is required`);
    const weaponIds = compatibility.weaponIds || [];
    const familyCodes = compatibility.familyCodes || [];
    assert(Array.isArray(weaponIds) && Array.isArray(familyCodes) && weaponIds.length + familyCodes.length > 0,
      `${path}.compatibility requires weaponIds or familyCodes`);
    weaponIds.forEach((id, index) => assert(UUID_PATTERN.test(id), `${path}.compatibility.weaponIds[${index}] must be a UUID`));
    familyCodes.forEach((code, index) => assert(typeof code === 'string' && code.trim(),
      `${path}.compatibility.familyCodes[${index}] is invalid`));
    return {
      identity: clone(skin.identity),
      compatibility: {weaponIds: clone(weaponIds), familyCodes: clone(familyCodes)},
      rarity: typeof skin.rarity === 'string' ? skin.rarity : 'COMMON',
      materials: validateMaterials(skin.materials, `${path}.materials`),
      muzzle: validateMuzzle(skin.muzzle, manifest, `${path}.muzzle`)
    };
  }

  function compatible(skin, weapon) {
    const identity = weapon?.identity || {};
    return skin.compatibility.weaponIds.includes(identity.id) ||
      skin.compatibility.familyCodes.includes(identity.familyCode);
  }

  function emptyResult(weapon, reason) {
    return {skinId: null, skinCode: 'builtin.default', fallback: true, fallbackReason: reason,
      materials: [], muzzle: null, weaponId: weapon?.identity?.id || null};
  }

  /** 未知、损坏或不兼容的 skinId 一律回退到该武器默认皮肤，而不是信任客户端参数。 */
  function resolve(catalog, manifest, weapon, requestedSkinId) {
    if (!weapon?.identity?.id) return emptyResult(weapon, 'UNKNOWN_WEAPON');
    const defaults = catalog?.defaultsByWeaponId || {};
    const defaultId = defaults[weapon.identity.id];
    const candidateIds = requestedSkinId && requestedSkinId !== defaultId ? [requestedSkinId, defaultId] : [defaultId];
    for (let index = 0; index < candidateIds.length; index++) {
      const skinId = candidateIds[index];
      const raw = skinId && catalog?.skins?.[skinId];
      if (!raw) continue;
      try {
        const skin = validateSkin(skinId, raw, manifest);
        if (!compatible(skin, weapon)) continue;
        return {skinId, skinCode: skin.identity.code, fallback: index > 0,
          fallbackReason: index > 0 ? 'UNKNOWN_OR_INCOMPATIBLE_SKIN' : null,
          materials: skin.materials, muzzle: skin.muzzle, weaponId: weapon.identity.id};
      } catch (error) {
        // 静态目录也可能在发布时被误编辑；单个坏皮肤不能阻断整局资源加载。
      }
    }
    return emptyResult(weapon, 'NO_VALID_DEFAULT');
  }

  /** 组合时保留模型校准值，仅让已校验皮肤覆盖允许售卖的视觉字段。 */
  function composeViewConfig(viewConfig, resolvedSkin) {
    const result = clone(viewConfig || {});
    if (!resolvedSkin?.muzzle) return result;
    if (resolvedSkin.muzzle.profile) result.muzzleProfile = resolvedSkin.muzzle.profile;
    result.muzzleOverrides = {...(result.muzzleOverrides || {}), ...(resolvedSkin.muzzle.overrides || {})};
    if (result.muzzleOverrides.muzzleScale || resolvedSkin.muzzle.overrides?.muzzleScale) {
      result.muzzleOverrides.muzzleScale = {...(viewConfig?.muzzleOverrides?.muzzleScale || {}),
        ...(resolvedSkin.muzzle.overrides?.muzzleScale || {})};
    }
    return result;
  }

  const MATERIAL_STATE = '__neonWeaponSkinMaterialState';

  function materialList(value) {
    return Array.isArray(value) ? value : [value];
  }

  function restoreNodeMaterials(node, state) {
    (state.generated || []).forEach(material => material?.dispose?.());
    state.generated = [];
    node.material = state.wasArray ? state.originals.slice() : state.originals[0];
  }

  /**
   * GLTF 的 Object3D.clone() 默认仍共享材质。此方法先记录实例最初的材质引用，再只克隆
   * 当前实例需要换色的材质；因此第一人称换肤不会污染第三人称模板或其他玩家实例。
   * 重复调用可直接切换皮肤，传入默认皮肤（materials 为空）则恢复模型原始材质。
   */
  function applyMaterials(root, resolvedSkin) {
    if (!root?.traverse) return {matched: 0, requested: resolvedSkin?.materials?.length || 0};
    const changes = new Map((resolvedSkin?.materials || []).map(entry => [entry.material, entry]));
    let matched = 0;
    root.traverse(node => {
      if (!node?.isMesh || !node.material) return;
      let state = node[MATERIAL_STATE];
      if (!state) {
        state = {wasArray: Array.isArray(node.material), originals: materialList(node.material).slice(), generated: []};
        Object.defineProperty(node, MATERIAL_STATE, {value: state, configurable: true});
      } else restoreNodeMaterials(node, state);
      if (!changes.size) return;
      const applied = state.originals.map(source => {
        const change = changes.get(source?.name);
        if (!change) return source;
        const material = source.clone();
        if (change.color != null && material.color?.setHex) material.color.setHex(change.color);
        if (change.roughness != null && 'roughness' in material) material.roughness = change.roughness;
        if (change.metalness != null && 'metalness' in material) material.metalness = change.metalness;
        material.needsUpdate = true;
        state.generated.push(material);
        matched++;
        return material;
      });
      node.material = state.wasArray ? applied : applied[0];
    });
    return {matched, requested: changes.size};
  }

  /** 模型实例销毁前释放换肤克隆材质，并恢复共享的原始 GLTF 材质引用。 */
  function releaseMaterials(root) {
    if (!root?.traverse) return;
    root.traverse(node => {
      const state = node?.[MATERIAL_STATE];
      if (!state) return;
      restoreNodeMaterials(node, state);
      delete node[MATERIAL_STATE];
    });
  }

  global.WeaponSkinRuntime = {LIMITS, validateSkin, compatible, resolve, composeViewConfig,
    applyMaterials, releaseMaterials};
})(window);
