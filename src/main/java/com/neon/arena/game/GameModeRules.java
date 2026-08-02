package com.neon.arena.game;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 模式级能力开关。武器、网络和地图运行时可以复用，但娱乐机制必须在模式入口
 * 明确启用，不能让 FFA 出生 Buff 通过零散判断泄漏到正式团队战。
 */
@Component
public final class GameModeRules {
  public enum Mode {
    FFA_ARENA(true,true), TEAM_DEATHMATCH(false,true);
    private final boolean buffsEnabled;
    private final boolean singleWeaponPerSlot;
    Mode(boolean buffsEnabled,boolean singleWeaponPerSlot){this.buffsEnabled=buffsEnabled;this.singleWeaponPerSlot=singleWeaponPerSlot;}
    public boolean buffsEnabled(){return buffsEnabled;}
    public boolean singleWeaponPerSlot(){return singleWeaponPerSlot;}
  }

  private final Mode mode;
  public GameModeRules(@Value("${game.mode:FFA_ARENA}") String mode){this.mode=Mode.valueOf(mode);}
  public Mode mode(){return mode;}
  public boolean buffsEnabled(){return mode.buffsEnabled();}
  public boolean singleWeaponPerSlot(){return mode.singleWeaponPerSlot();}
}
