package com.neon.arena.game;

import java.util.Locale;

public enum BotDifficulty {
  OFF(false,0,0,0,0,0),
  EASY(true,2_400,850,1_250,7.0,.58),
  HARD(true,1_800,300,420,1.25,.82),
  INFERNO(true,320,170,245,.18,.96);

  private final boolean enabled;
  private final long reactionMs,shotMinMs,shotMaxMs;
  private final double aimErrorDegrees,movementScale;

  BotDifficulty(boolean enabled,long reactionMs,long shotMinMs,long shotMaxMs,double aimErrorDegrees,double movementScale){this.enabled=enabled;this.reactionMs=reactionMs;this.shotMinMs=shotMinMs;this.shotMaxMs=shotMaxMs;this.aimErrorDegrees=aimErrorDegrees;this.movementScale=movementScale;}
  public boolean enabled(){return enabled;}
  public long reactionMs(){return reactionMs;}
  public long shotMinMs(){return shotMinMs;}
  public long shotMaxMs(){return shotMaxMs;}
  public double aimErrorRadians(){return Math.toRadians(aimErrorDegrees);}
  public double movementScale(){return movementScale;}
  public double aimHeightOffset(){return switch(this){case EASY->-.88;case HARD->-.7;case INFERNO->-.2;case OFF->-.7;};}
  public static BotDifficulty parse(String value){try{return valueOf(value.trim().toUpperCase(Locale.ROOT));}catch(Exception ignored){return HARD;}}
}
