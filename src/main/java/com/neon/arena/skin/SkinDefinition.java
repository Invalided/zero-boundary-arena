package com.neon.arena.skin;

import java.util.Set;

/**
 * 服务端发布的只读皮肤定义。skinId 是网络和持久化使用的稳定主键，code 仅用于配置与排查。
 */
public record SkinDefinition(
    String skinId,
    String code,
    String displayName,
    Set<String> weaponIds,
    Set<String> familyCodes,
    String materialVariant,
    String muzzleProfile,
    boolean grantedByDefault,
    boolean defaultForCompatibleWeapon) {
}
