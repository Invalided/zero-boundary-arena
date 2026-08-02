package com.neon.arena.weapon;

/**
 * 玩家装备栏的逻辑位置。槽位与武器类别不同：突击步枪、狙击枪都属于 PRIMARY，
 * 但它们仍保留各自类别用于伤害、开镜和动画行为。
 */
public enum WeaponSlot {
  PRIMARY,
  SECONDARY,
  MELEE
}
