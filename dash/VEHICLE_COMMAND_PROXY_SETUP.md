# Vehicle-Command Proxy 部署指南

根据 Tesla 官方文档，**配置 Fleet Telemetry 必须通过 vehicle-command HTTP proxy**。直接调用 Fleet API 会返回 `invalid_command` 错误。

## 为什么需要 Vehicle-Command Proxy？

Tesla 在 2024 年之后对新的开发者应用实施了更严格的安全要求：

1. **端到端命令认证**：车辆只接受通过私钥签名的命令
2. **命令签名**：vehicle-command proxy 使用私钥对命令进行签名
3. **安全转发**：proxy 将签名的命令转发到 Tesla Fleet API

## 部署步骤

### 1. 安装 vehicle-command

参考官方仓库：https://github.com/teslamotors/vehicle-command

#### 使用 Docker（推荐）

```bash
docker pull tesla/vehicle-command:latest
```

#### 本地安装

```bash
# 需要 Go 1.23.0 或更高版本
go get ./...
go build ./...
go install ./...
```

### 2. 生成私钥和公钥

```bash
export TESLA_KEY_NAME=$(whoami)
tesla-keygen create > public_key.pem
```

这会：
- 生成私钥并存储到系统密钥环
- 输出公钥到 `public_key.pem` 文件

### 3. 注册公钥到 Tesla 开发者平台

1. 登录 Tesla 开发者平台
2. 注册你的域名（例如：`example.com`）
3. 将 `public_key.pem` 上传到 `https://your-domain.com/.well-known/tesla-public-key.pem`
4. 确保公钥文件可以通过 HTTPS 访问

### 4. 生成 TLS 证书

```bash
mkdir config
openssl req -x509 -nodes -newkey ec \
    -pkeyopt ec_paramgen_curve:secp384r1 \
    -pkeyopt ec_param_enc:named_curve  \
    -subj '/CN=localhost' \
    -keyout config/tls-key.pem -out config/tls-cert.pem -sha256 -days 3650 \
    -addext "extendedKeyUsage = serverAuth" \
    -addext "keyUsage = digitalSignature, keyCertSign, keyAgreement"
```

### 5. 运行 vehicle-command proxy

```bash
tesla-http-proxy \
    -tls-key config/tls-key.pem \
    -cert config/tls-cert.pem \
    -key-file config/fleet-key.pem \
    -port 4443
```

或使用 Docker：

```bash
docker run --security-opt=no-new-privileges:true \
    -v ./config:/config \
    -p 127.0.0.1:4443:4443 \
    tesla/vehicle-command:latest \
    -tls-key /config/tls-key.pem \
    -cert /config/tls-cert.pem \
    -key-file /config/fleet-key.pem \
    -host 0.0.0.0 \
    -port 4443
```

### 6. 配置车辆配对密钥

用户需要将你的应用密钥配对到车辆：

1. 提供链接：`https://tesla.com/_ak/your-domain.com`
2. 用户在 Tesla 官方应用中打开链接
3. 用户批准请求
4. 车辆会收到配对命令（需要车辆在线）

### 7. 配置仪表盘

在仪表盘配置面板中填写：

- **Vehicle-Command Proxy URL**: `https://your-proxy.example.com`
- **WebSocket URL**: `wss://your-telemetry-server.com/telemetry`
- **其他配置**：OAuth Token、Vehicle ID 等

## 部署到生产环境

### Railway 部署

1. 创建新的 Railway 项目
2. 添加环境变量：
   - `TESLA_KEY_NAME`: 密钥名称
   - `TESLA_HTTP_PROXY_PORT`: 端口（默认 4443）
3. 上传配置文件（TLS 证书、私钥）
4. 部署并获取公网 URL

### 注意事项

- **TLS 证书**：生产环境需要使用有效的 TLS 证书（Let's Encrypt 等）
- **私钥安全**：私钥必须保密，不要提交到代码仓库
- **端口**：生产环境使用标准端口 443（HTTPS）
- **防火墙**：确保 proxy 服务器可以从公网访问

## 故障排除

### 错误：`invalid_command fleet_telemetry_config`

**原因**：未使用 vehicle-command proxy，或 proxy 配置不正确

**解决**：
1. 确认已部署 vehicle-command proxy
2. 确认 proxy URL 配置正确
3. 检查私钥是否正确配置
4. 检查公钥是否已注册

### 错误：用户未授权第三方应用

**原因**：用户未登录 Tesla 应用，或使用了不同的邮箱

**解决**：
1. 确保用户使用授权时的相同邮箱登录 Tesla 应用
2. 重新授权应用

### 错误：应用未注册

**原因**：应用未在用户所在区域注册，或公钥不可访问

**解决**：
1. 调用注册端点注册应用到用户所在区域
2. 确保公钥文件可通过 HTTPS 访问

## 相关链接

- [Tesla Fleet Telemetry 文档](https://developer.tesla.com/docs/fleet-api#fleet-telemetry)
- [vehicle-command GitHub 仓库](https://github.com/teslamotors/vehicle-command)
- [Tesla 开发者平台](https://developer.tesla.com/)

## 简化方案

如果部署 vehicle-command proxy 太复杂，可以考虑：

1. **使用 Tesla 官方应用配置**：在 Tesla 官方应用中直接配置 Fleet Telemetry
2. **使用第三方服务**：某些第三方服务可能提供 vehicle-command proxy 服务

