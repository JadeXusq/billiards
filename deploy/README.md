# 掌上台球 · 腾讯云 Lighthouse 部署手册

与捡红点、干瞪眼共用同一实例（lhins-rqks9jzc / 49.232.26.158）。

## 架构特点

- **单容器**：Node 服务端同时提供静态托管（client/ + shared/）和 WebSocket 权威模拟
- **零运行时依赖**：无需 npm install，克隆即可跑
- 客户端用 `ws://location.host` 同源连接，**零配置**

## 端口规划

| 项目 | 地址 |
|------|------|
| 前端 + 游戏服（同端口） | http://49.232.26.158:8081/ |

## 部署（代码已在 /opt/billiards）

```bash
cd /opt/billiards
docker compose up -d --build

# 验证
curl -I http://localhost:8081/
```

## 更新部署

```bash
cd /opt/billiards
docker compose up -d --build
```

## 运维命令

```bash
docker compose ps        # 容器状态
docker compose logs -f   # 日志
docker compose restart   # 重启
```

> 房间为内存态，重启清档。
