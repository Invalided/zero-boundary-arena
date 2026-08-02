package com.neon.arena.game;

/** 服务端权威武器动作；只有 READY 状态允许发射或开始另一个动作。 */
public enum WeaponAction { READY, CYCLING, RELOADING, EQUIPPING, THROWING_GRENADE }
