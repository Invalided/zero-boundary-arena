package com.neon.arena.game;

import java.util.Locale;

/** Stable server-side pickup types. Map files reference these codes rather than client visuals. */
public enum WorldItemType {
  WEAPON,
  MEDKIT_SMALL,
  ARMOR_VEST,
  SPEED_BOOST,
  STEALTH_FIELD,
  AMMO_BOX,
  THROWABLE_FRAG,
  THROWABLE_FLASH,
  THROWABLE_SMOKE;

  public static WorldItemType parse(String value){
    if(value==null||value.isBlank())return WEAPON;
    try{return valueOf(value.trim().toUpperCase(Locale.ROOT));}
    catch(IllegalArgumentException ignored){throw new IllegalArgumentException("Unknown world item type: "+value);}
  }

  public long defaultRespawnMinMs(){return switch(this){
    case WEAPON->10_000;
    case MEDKIT_SMALL->20_000;
    case ARMOR_VEST->28_000;
    case SPEED_BOOST->32_000;
    case STEALTH_FIELD->45_000;
    case AMMO_BOX->8_000;
    case THROWABLE_FRAG,THROWABLE_FLASH,THROWABLE_SMOKE->25_000;
  };}

  public long defaultRespawnMaxMs(){return switch(this){
    case WEAPON->10_000;
    case MEDKIT_SMALL->28_000;
    case ARMOR_VEST->38_000;
    case SPEED_BOOST->44_000;
    case STEALTH_FIELD->60_000;
    case AMMO_BOX->12_000;
    case THROWABLE_FRAG,THROWABLE_FLASH,THROWABLE_SMOKE->35_000;
  };}
}
