package com.neon.arena.weapon;

/**
 * 武器的扳机工作方式。客户端用它决定按住鼠标是否持续发射，服务端仍会对
 * 每一发执行射速、弹药和动作状态校验，不能把客户端连发当作可信结果。
 */
public enum WeaponFireMode {
  SEMI_AUTO,
  FULL_AUTO,
  BURST
}
