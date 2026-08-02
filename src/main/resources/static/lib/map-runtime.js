(function (global) {
  'use strict';

  const DEFAULTS = Object.freeze({
    eyeHeight: 1.70,
    playerHeight: 1.70,
    radius: 0.45,
    stepHeight: 0.30,
    groundSnap: 0.15
  });

  const clone = value => JSON.parse(JSON.stringify(value));
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  /**
   * V1 兼容逻辑只存在于加载边界。游戏渲染和移动始终消费 V2 结构，避免迁移期间出现
   * “画面仍读 obstacles、碰撞却读 colliders”的双重数据源。
   */
  function normalize(source) {
    if (Number(source?.schemaVersion || 1) === 2) return clone(source);
    const limit = finite(source?.limit);
    const groundSize = finite(source?.groundSize) || limit * 2;
    return {
      schemaVersion: 2,
      id: String(source?.id || ''),
      revision: 1,
      units: 'meter',
      environment: {theme: 'legacy_arena', groundPrefab: '', sky: ''},
      bounds: {type: 'BOX', center: [0, 50, 0], size: [limit * 2, 100, limit * 2]},
      groundSize,
      colliders: (source?.obstacles || []).map((obstacle, index) => ({
        id: `legacy-box-${index + 1}`,
        type: 'BOX',
        center: [finite(obstacle.x), finite(obstacle.height) / 2, finite(obstacle.z)],
        size: [finite(obstacle.width), finite(obstacle.height), finite(obstacle.depth)],
        surface: obstacle.surface || 'concrete'
      })),
      visuals: [],
      spawnZones: [{
        id: 'legacy-ffa', modes: ['FFA'], team: 'ANY', clearance: 1,
        candidates: (source?.spawns || []).map(spawn => ({position: [finite(spawn.x), 0, finite(spawn.z)], yaw: 0}))
      }],
      pickups: (source?.pickups || []).map(pickup => ({
        id: String(pickup.id || ''), weaponId: String(pickup.weapon || ''),
        position: [finite(pickup.x), 0, finite(pickup.z)]
      })),
      landmarks: [],
      navigationNodes: []
    };
  }

  function create(source, options = {}) {
    const definition = normalize(source);
    const settings = {...DEFAULTS, ...options};
    const colliders = definition.colliders || [];
    const bounds = definition.bounds;

    function insideFootprint(collider, x, z, inset = 0) {
      if (collider.type === 'RAMP') return rampCoordinates(collider, x, z, inset) !== null;
      const center = collider.center, size = collider.size;
      return Math.abs(x - center[0]) <= size[0] / 2 - inset
        && Math.abs(z - center[2]) <= size[2] / 2 - inset;
    }

    /**
     * 坡道 origin 是低端边缘中心。先把世界坐标投影为“沿坡距离/横向距离”，四种朝向
     * 因而共享同一条高度公式，客户端不会为每个方向复制一套容易写反的分支。
     */
    function rampCoordinates(ramp, x, z, inset = 0) {
      const ox = ramp.origin[0], oz = ramp.origin[2];
      let along, across;
      switch (ramp.forward) {
        case 'POS_X': along = x - ox; across = z - oz; break;
        case 'NEG_X': along = ox - x; across = z - oz; break;
        case 'POS_Z': along = z - oz; across = x - ox; break;
        case 'NEG_Z': along = oz - z; across = x - ox; break;
        default: return null;
      }
      if (along < 0 || along > ramp.run || Math.abs(across) > ramp.width / 2 - inset) return null;
      return {along, across};
    }

    function surfaceHeight(collider, x, z) {
      if (collider.type === 'RAMP') {
        const local = rampCoordinates(collider, x, z);
        return local ? collider.origin[1] + collider.rise * local.along / collider.run : null;
      }
      if (!insideFootprint(collider, x, z, -settings.radius)) return null;
      return collider.center[1] + collider.size[1] / 2;
    }

    /** 返回可从当前位置踏上或落到的最高表面；null 与合法的 0m 地面严格区分。 */
    function findGroundHeight(x, z, currentFeetY, maxRise = settings.stepHeight,
        maxDrop = settings.groundSnap) {
      let result = inBounds(x, z, 0) && 0 <= currentFeetY + maxRise + 1e-7
          && 0 >= currentFeetY - maxDrop - 1e-7 ? 0 : null;
      for (const collider of colliders) {
        if (collider.type !== 'BOX' && collider.type !== 'PLATFORM' && collider.type !== 'RAMP') continue;
        const height = surfaceHeight(collider, x, z);
        if (height == null || height > currentFeetY + maxRise + 1e-7
            || height < currentFeetY - maxDrop - 1e-7) continue;
        if (result == null || height > result) result = height;
      }
      return result;
    }

    function inBounds(x, z, radius = settings.radius) {
      if (!bounds) return true;
      if (bounds.type === 'POLYGON') {
        const vertices = bounds.vertices || [];
        if (vertices.length < 3) return false;
        let area2 = 0;
        for (let i = 0; i < vertices.length; i++) {
          const a = vertices[i], b = vertices[(i + 1) % vertices.length];
          area2 += a[0] * b[1] - b[0] * a[1];
        }
        const orientation = Math.sign(area2);
        return vertices.every((a, index) => {
          const b = vertices[(index + 1) % vertices.length];
          const ex = b[0] - a[0], ez = b[1] - a[1];
          const signedDistance = orientation * (ex * (z - a[1]) - ez * (x - a[0]))
            / Math.hypot(ex, ez);
          return signedDistance >= radius - 1e-7;
        });
      }
      if (bounds.type !== 'BOX') return false;
      const minX = bounds.center[0] - bounds.size[0] / 2 + radius;
      const maxX = bounds.center[0] + bounds.size[0] / 2 - radius;
      const minZ = bounds.center[2] - bounds.size[2] / 2 + radius;
      const maxZ = bounds.center[2] + bounds.size[2] / 2 - radius;
      return x > minX && x < maxX && z > minZ && z < maxZ;
    }

    function overlapsSolid(collider, x, z, feetY, allowStep = true) {
      if (collider.type === 'RAMP') {
        let along,across;const ox=collider.origin[0],oz=collider.origin[2];
        switch(collider.forward){case 'POS_X':along=x-ox;across=z-oz;break;case 'NEG_X':along=ox-x;across=z-oz;break;case 'POS_Z':along=z-oz;across=x-ox;break;case 'NEG_Z':along=oz-z;across=x-ox;break;default:return false;}
        const nearestAlong=Math.max(0,Math.min(collider.run,along)),nearestAcross=Math.max(-collider.width/2,Math.min(collider.width/2,across)),distanceAlong=along-nearestAlong,distanceAcross=across-nearestAcross;
        if(distanceAlong*distanceAlong+distanceAcross*distanceAcross>=settings.radius*settings.radius)return false;
        const surface=collider.origin[1]+collider.rise*nearestAlong/collider.run,top=feetY+settings.playerHeight;
        return surface>collider.origin[1]+1e-7&&feetY<surface-1e-7&&top>collider.origin[1]+1e-7;
      }
      if (collider.type === 'PLATFORM' && !collider.solid) return false;
      const center = collider.center, size = collider.size;
      const horizontal = Math.abs(x - center[0]) < size[0] / 2 + settings.radius
        && Math.abs(z - center[2]) < size[2] / 2 + settings.radius;
      if (!horizontal) return false;
      const bottom = center[1] - size[1] / 2, top = center[1] + size[1] / 2;
      const vertical = feetY < top - 1e-7 && feetY + settings.playerHeight > bottom + 1e-7;
      // 不高于步高的顶面由地面查询接管，水平移动不应把玩家挡在小台阶外。
      return vertical && (!allowStep || top - feetY > settings.stepHeight + 1e-7);
    }

    function collides(x, eyeY, z) {
      if (!inBounds(x, z)) return true;
      const feetY = eyeY - settings.eyeHeight;
      return colliders.some(collider => overlapsSolid(collider, x, z, feetY, false));
    }

    /** 逐轴处理保留贴墙滑动手感；成功跨越小台阶时同时返回新的脚底高度。 */
    function moveHorizontal(position, dx, dz, allowStep = true) {
      let {x, z, feetY} = position;
      const attempt = (nextX, nextZ) => {
        if (!inBounds(nextX, nextZ)) return false;
        const ground = allowStep
          ? findGroundHeight(nextX, nextZ, feetY, settings.stepHeight, settings.groundSnap) : null;
        const candidateFeetY = ground == null ? feetY : ground;
        if (colliders.some(collider => overlapsSolid(collider, nextX, nextZ, candidateFeetY, false))) return false;
        feetY = candidateFeetY;
        x = nextX; z = nextZ; return true;
      };
      attempt(x + dx, z);
      attempt(x, z + dz);
      return {x, z, feetY};
    }

    function resolveVertical(x, z, eyeY, verticalVelocity, dt) {
      const currentFeetY = eyeY - settings.eyeHeight;
      const nextEyeY = eyeY + verticalVelocity * dt;
      if (verticalVelocity > 0) {
        let ceiling = null;
        for (const collider of colliders) {
          if (collider.type === 'RAMP' || (collider.type === 'PLATFORM' && !collider.solid)) continue;
          if (!insideFootprint(collider, x, z, -settings.radius)) continue;
          const bottom = collider.center[1] - collider.size[1] / 2;
          if (eyeY <= bottom + 1e-7 && nextEyeY >= bottom - 1e-7
              && (ceiling == null || bottom < ceiling)) ceiling = bottom;
        }
        return ceiling == null
          ? {eyeY: nextEyeY, verticalVelocity, onGround: false}
          : {eyeY: ceiling - 1e-6, verticalVelocity: 0, onGround: false};
      }
      const nextFeetY = nextEyeY - settings.eyeHeight;
      const ground = findGroundHeight(x, z, currentFeetY, 1e-6,
        currentFeetY - nextFeetY + settings.groundSnap);
      return ground == null
        ? {eyeY: nextEyeY, verticalVelocity, onGround: false}
        : {eyeY: ground + settings.eyeHeight, verticalVelocity: 0, onGround: true};
    }

    return {definition, settings, inBounds, collides, findGroundHeight, moveHorizontal, resolveVertical,
      rampCoordinates, surfaceHeight};
  }

  global.MapRuntime = {DEFAULTS, normalize, create};
})(typeof window !== 'undefined' ? window : globalThis);
