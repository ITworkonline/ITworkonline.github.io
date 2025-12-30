# Tesla Fleet Telemetry 仪表盘

这是一个基于 Tesla Fleet Telemetry API 的实时车辆数据仪表盘，可以显示车辆速度、电池电量、里程等信息。

## 功能特性

- ✅ **实时速度显示** - 从 Fleet Telemetry 服务器获取实时速度数据
- ✅ **电池电量监控** - 显示当前电池电量和充电状态
- ✅ **里程显示** - 显示车辆总里程
- ✅ **现代化 UI** - 科技感十足的仪表盘界面
- ✅ **自动更新** - 可配置的自动刷新间隔
- ✅ **OAuth 登录** - 支持 Tesla OAuth 认证（用于配置车辆）

## 使用方法

### 1. 配置 Fleet Telemetry 服务器

首先，你需要部署一个 Fleet Telemetry 服务器。这个服务器会接收来自 Tesla 车辆的数据。

**推荐部署平台：**
- Railway
- Render
- Vercel
- 其他支持 WebSocket 的平台

### 2. 配置仪表盘

1. 打开仪表盘页面
2. 点击右下角的 ⚙️ 按钮打开配置面板
3. 填写以下信息：

   **Fleet Telemetry 配置（必需）：**
   - **Telemetry 服务器 URL**: 你的 Telemetry 服务器 HTTP URL
     - 例如: `https://your-telemetry.railway.app`
   - **车辆 VIN**: 你的 Tesla 车辆识别码
     - 可在 Tesla 应用中查看，或查看前挡风玻璃左下角
   - **WebSocket URL**: 用于配置车辆的 WebSocket URL
     - 例如: `wss://your-telemetry.railway.app/telemetry`
     - 通常与服务器 URL 相同，但使用 `wss://` 协议

4. 点击"保存配置"

### 3. 配置车辆 Fleet Telemetry（可选）

如果你需要通过仪表盘配置车辆发送数据到你的 Telemetry 服务器：

1. 在配置面板中填写 **OAuth 配置**：
   - **Client ID**: 从 Tesla 开发者平台获取
   - **Client Secret**: 从 Tesla 开发者平台获取
   - **Redirect URI**: 必须与 Tesla 开发者平台中设置的一致

2. 点击"🔐 登录 Tesla"进行 OAuth 认证

3. 登录成功后，点击"⚙️ 配置车辆 Fleet Telemetry"

   这会调用 Tesla Fleet API 的 `fleet_telemetry_config` 端点，配置车辆将数据发送到你的服务器。

### 4. 开始使用

配置完成后，仪表盘会自动开始从 Telemetry 服务器获取数据并更新显示。

- 点击"⏸ 停止读取"可以暂停数据更新
- 点击"▶ 开始读取"可以恢复数据更新

## API 端点说明

仪表盘会向你的 Telemetry 服务器发送以下请求：

### 获取车辆数据
```
GET /api/vehicle/{VIN}
```

**响应格式：**
```json
{
  "speed": 65.5,           // 速度（km/h 或 mph）
  "VehicleSpeed": 40.7,    // 速度（mph，Fleet Telemetry 格式）
  "odometer": 12345.6,     // 里程（km）
  "batteryLevel": 85,      // 电池电量（%）
  "chargingState": "Charging"  // 充电状态
}
```

## 技术栈

- **HTML5** - 页面结构
- **CSS3** - 样式和动画
- **JavaScript (ES6+)** - 业务逻辑
- **Tesla Fleet API** - 车辆数据 API
- **Tesla Fleet Telemetry** - 实时遥测数据

## 注意事项

1. **Telemetry 服务器**：你需要自己部署一个 Fleet Telemetry 服务器来接收车辆数据。仪表盘只是前端展示界面。

2. **CORS 配置**：确保你的 Telemetry 服务器配置了正确的 CORS 头，允许仪表盘域名访问。

3. **数据格式**：Telemetry 服务器返回的数据格式应该符合上述 API 说明。

4. **速度单位**：Fleet Telemetry 使用 `VehicleSpeed` 字段时，单位为 mph（英里/小时），仪表盘会自动转换为 km/h。

5. **OAuth 配置**：只有在需要配置车辆发送数据时才需要 OAuth。如果车辆已经配置好，只需要填写 Telemetry 服务器 URL 和 VIN 即可。

## 故障排除

### 无法获取数据

1. 检查 Telemetry 服务器 URL 是否正确
2. 检查 VIN 是否正确
3. 检查浏览器控制台是否有错误信息
4. 确认 Telemetry 服务器正在运行

### OAuth 登录失败

1. 检查 Client ID 和 Client Secret 是否正确
2. 检查 Redirect URI 是否与 Tesla 开发者平台中设置的一致（包括协议、域名、路径）
3. 确认应用在 Tesla 开发者平台中已正确配置

### 配置车辆失败

1. 确保已通过 OAuth 登录
2. 确保已获取车辆列表
3. 检查 WebSocket URL 是否正确
4. 某些新应用可能需要通过 vehicle-command proxy 调用此端点

## 许可证

MIT License

