package com.neon.arena.game;

/**
 * 客户端只提交操作意图，不提交最终坐标。sequence 用于标识输入顺序，
 * 服务端会在快照中返回最后处理的序号，供客户端做预测校正。
 */
public record PlayerInput(long sequence, double forward, double right, boolean sprint, double yaw, double pitch) {
  public static PlayerInput idle() { return new PlayerInput(0, 0, 0, false, 0, 0); }
  /** 停止移动但保留视角；复活、结算等状态重置不能顺带把玩家转回世界 yaw=0。 */
  public static PlayerInput idle(double yaw,double pitch) {
    return new PlayerInput(0,0,0,false,yaw,pitch);
  }
}
