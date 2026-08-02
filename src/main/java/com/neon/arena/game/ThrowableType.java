package com.neon.arena.game;

import java.util.Locale;

/** Stable server identifiers for inventory, projectiles and client effects. */
public enum ThrowableType {
  FRAG("frag_grenade", 2_500),
  FLASH("flash_grenade", 1_800),
  SMOKE("smoke_grenade", 1_800);

  private final String id;
  private final long fuseMs;

  ThrowableType(String id,long fuseMs){this.id=id;this.fuseMs=fuseMs;}
  public String id(){return id;}
  public long fuseMs(){return fuseMs;}

  public static ThrowableType parse(String value,ThrowableType fallback){
    if(value==null||value.isBlank())return fallback;
    String normalized=value.trim().toLowerCase(Locale.ROOT);
    for(ThrowableType type:values())if(type.id.equals(normalized)||type.name().equalsIgnoreCase(normalized))return type;
    return fallback;
  }
}
