package com.neon.arena.game;

/** FFA 出生选择。NONE 和所有具体效果都由服务端解析，客户端只能提交枚举名。 */
public enum SpawnBuff {
  NONE("无增益"),
  NO_AMMO("没有子弹"),
  LEFT_TRAJECTORY("弹道偏左"),
  FEARLESS("无所畏惧");

  private final String displayName;
  SpawnBuff(String displayName) { this.displayName = displayName; }
  public String displayName() { return displayName; }

  public static SpawnBuff parse(String value) {
    if (value == null || value.isBlank()) return NONE;
    try { return valueOf(value.trim().toUpperCase()); }
    catch (IllegalArgumentException ignored) { return NONE; }
  }
}
