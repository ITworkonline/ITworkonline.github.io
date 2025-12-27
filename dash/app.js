// Tesla Fleet API 配置
const TESLA_API_BASE = 'https://fleet-api.prd.na.vn.cloud.tesla.com';
const TESLA_AUTH_BASE = 'https://auth.tesla.com'; // 中国区使用 .cn，国际区使用 .com

// 全局变量
let config = {
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    apiToken: '',
    refreshToken: '',
    tokenExpiresAt: 0,
    vehicleId: '',
    updateInterval: 2
};

let updateTimer = null;
let speedometerMaxSpeed = 200; // km/h

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    loadConfig();
    initializeSpeedometer();
    
    // 设置默认 redirect URI
    if (!config.redirectUri) {
        // 如果路径以 index.html 结尾，尝试使用目录路径（更灵活）
        let redirectUri = window.location.origin + window.location.pathname;
        // 如果路径是 /dash/index.html，使用 /dash 作为 redirect URI
        if (redirectUri.endsWith('/index.html')) {
            redirectUri = redirectUri.replace('/index.html', '');
        }
        // 如果路径是 /dash/，去掉末尾的斜杠
        if (redirectUri.endsWith('/') && redirectUri !== window.location.origin + '/') {
            redirectUri = redirectUri.slice(0, -1);
        }
        config.redirectUri = redirectUri;
    }
    
    // 确保 Redirect URI 输入框有值
    const redirectUriInput = document.getElementById('redirectUri');
    if (redirectUriInput) {
        redirectUriInput.value = config.redirectUri || '';
        
        // 如果输入框为空，尝试自动填充
        if (!redirectUriInput.value) {
            let autoUri = window.location.origin;
            if (window.location.pathname.includes('/dash')) {
                autoUri = window.location.origin + '/dash';
            } else if (window.location.pathname !== '/') {
                autoUri = window.location.origin + window.location.pathname.replace('/index.html', '').replace(/\/$/, '');
            }
            redirectUriInput.value = autoUri;
            config.redirectUri = autoUri;
        }
    }
    
    // 检查 URL 中是否有 OAuth 回调参数
    handleOAuthCallback();
    
    // 如果有 token，开始更新
    if (config.apiToken && config.vehicleId) {
        // 检查 token 是否过期
        if (isTokenExpired()) {
            refreshAccessToken();
        } else {
            startUpdates();
        }
    }
    
    // 监听配置变化
    document.getElementById('updateInterval').addEventListener('change', function() {
        if (updateTimer) {
            clearInterval(updateTimer);
            startUpdates();
        }
    });
});

// 加载配置
function loadConfig() {
    const savedConfig = localStorage.getItem('teslaDashConfig');
    if (savedConfig) {
        const saved = JSON.parse(savedConfig);
        config = { ...config, ...saved };
        
        // 填充表单
        document.getElementById('clientId').value = config.clientId || '';
        document.getElementById('clientSecret').value = config.clientSecret || '';
        document.getElementById('redirectUri').value = config.redirectUri || window.location.origin + window.location.pathname;
        document.getElementById('apiToken').value = config.apiToken || '';
        document.getElementById('vehicleId').value = config.vehicleId || '';
        document.getElementById('updateInterval').value = config.updateInterval || 2;
    }
}

// 保存配置
function saveConfig() {
    config.clientId = document.getElementById('clientId').value.trim();
    config.clientSecret = document.getElementById('clientSecret').value.trim();
    config.redirectUri = document.getElementById('redirectUri').value.trim();
    config.apiToken = document.getElementById('apiToken').value.trim();
    config.vehicleId = document.getElementById('vehicleId').value.trim();
    config.updateInterval = parseInt(document.getElementById('updateInterval').value) || 2;
    
    localStorage.setItem('teslaDashConfig', JSON.stringify(config));
    
    // 重新开始更新
    if (updateTimer) {
        clearInterval(updateTimer);
    }
    
    if (config.apiToken && config.vehicleId) {
        if (isTokenExpired()) {
            refreshAccessToken();
        } else {
            startUpdates();
        }
    }
    
    toggleConfig();
    alert('配置已保存！');
}

// 切换配置面板
function toggleConfig() {
    const panel = document.getElementById('configPanel');
    panel.classList.toggle('show');
}

// 初始化速度表盘
function initializeSpeedometer() {
    const svg = document.querySelector('.speedometer-svg');
    const ticksGroup = document.getElementById('speedTicks');
    
    // 创建刻度线
    for (let i = 0; i <= 20; i++) {
        const angle = -135 + (i * 270 / 20); // -135 到 135 度
        const rad = (angle * Math.PI) / 180;
        const radius = 150;
        const centerX = 200;
        const centerY = 150;
        
        const x1 = centerX + radius * Math.cos(rad);
        const y1 = centerY + radius * Math.sin(rad);
        const x2 = centerX + (radius - 15) * Math.cos(rad);
        const y2 = centerY + (radius - 15) * Math.sin(rad);
        
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tick.setAttribute('x1', x1);
        tick.setAttribute('y1', y1);
        tick.setAttribute('x2', x2);
        tick.setAttribute('y2', y2);
        tick.setAttribute('stroke', i % 5 === 0 ? '#ffffff' : '#666666');
        tick.setAttribute('stroke-width', i % 5 === 0 ? '3' : '1');
        
        ticksGroup.appendChild(tick);
        
        // 添加数字标签（每 20 km/h）
        if (i % 5 === 0) {
            const labelValue = (i * speedometerMaxSpeed / 20);
            const labelX = centerX + (radius - 30) * Math.cos(rad);
            const labelY = centerY + (radius - 30) * Math.sin(rad);
            
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', labelX);
            text.setAttribute('y', labelY);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('fill', '#ffffff');
            text.setAttribute('font-size', '14');
            text.setAttribute('font-weight', '600');
            text.textContent = labelValue;
            
            ticksGroup.appendChild(text);
        }
    }
}

// 开始更新数据
function startUpdates() {
    if (!config.apiToken || !config.vehicleId) {
        updateConnectionStatus('error', '请先配置 API Token 和 Vehicle ID');
        return;
    }
    
    // 立即执行一次
    fetchVehicleData();
    
    // 设置定时更新
    updateTimer = setInterval(() => {
        fetchVehicleData();
    }, config.updateInterval * 1000);
}

// 检查 token 是否过期
function isTokenExpired() {
    if (!config.tokenExpiresAt) return true;
    return Date.now() >= config.tokenExpiresAt - 60000; // 提前 1 分钟刷新
}

// 刷新 access token
async function refreshAccessToken() {
    if (!config.refreshToken || !config.clientId || !config.clientSecret) {
        updateConnectionStatus('error', '缺少刷新 token 或 OAuth 配置');
        return;
    }

    try {
        const response = await fetch(`${TESLA_AUTH_BASE}/oauth2/v3/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: config.clientId,
                client_secret: config.clientSecret,
                refresh_token: config.refreshToken
            })
        });

        if (!response.ok) {
            throw new Error(`Token 刷新失败: ${response.status}`);
        }

        const data = await response.json();
        config.apiToken = data.access_token;
        config.refreshToken = data.refresh_token || config.refreshToken;
        config.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
        
        localStorage.setItem('teslaDashConfig', JSON.stringify(config));
        document.getElementById('apiToken').value = config.apiToken;
        
        startUpdates();
    } catch (error) {
        console.error('刷新 token 失败:', error);
        updateConnectionStatus('error', 'Token 已过期，请重新登录');
    }
}

// 启动 OAuth 登录
function startOAuthLogin() {
    try {
        const clientId = document.getElementById('clientId').value.trim();
        const redirectUri = document.getElementById('redirectUri').value.trim();
        
        console.log('开始 OAuth 登录流程...');
        console.log('Client ID:', clientId ? clientId.substring(0, 10) + '...' : '未填写');
        console.log('Redirect URI:', redirectUri);
        console.log('Auth Base:', TESLA_AUTH_BASE);
        
        if (!clientId) {
            alert('请先填写 Client ID');
            updateOAuthStatus('error', '请先填写 Client ID');
            return;
        }
        
        if (!redirectUri) {
            alert('请先填写 Redirect URI');
            updateOAuthStatus('error', '请先填写 Redirect URI');
            return;
        }
        
        // 验证 Redirect URI 格式
        try {
            new URL(redirectUri);
        } catch (e) {
            alert('Redirect URI 格式不正确，请使用完整的 URL（例如：https://blog.itworkonline.top/dash）');
            updateOAuthStatus('error', 'Redirect URI 格式不正确');
            return;
        }
        
        // 保存配置（包括 clientSecret）
        const clientSecret = document.getElementById('clientSecret').value.trim();
        config.clientId = clientId;
        config.clientSecret = clientSecret;
        config.redirectUri = redirectUri;
        localStorage.setItem('teslaDashConfig', JSON.stringify(config));
        
        console.log('已保存配置 - Client ID:', clientId.substring(0, 10) + '...');
        console.log('已保存配置 - Client Secret:', clientSecret ? '已设置' : '未设置');
        
        // 生成 state 参数（用于防止 CSRF 攻击）
        const state = generateRandomString(32);
        sessionStorage.setItem('oauth_state', state);
        
        // 构建授权 URL
        const authUrl = new URL(`${TESLA_AUTH_BASE}/oauth2/v3/authorize`);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'openid offline_access vehicle_device_data vehicle_cmds');
        authUrl.searchParams.set('state', state);
        
        console.log('准备跳转到授权页面:', authUrl.toString());
        updateOAuthStatus('loading', '正在跳转到 Tesla 登录页面...');
        
        // 跳转到授权页面
        window.location.href = authUrl.toString();
        
    } catch (error) {
        console.error('OAuth 登录错误:', error);
        alert('登录失败: ' + error.message);
        updateOAuthStatus('error', '错误: ' + error.message);
    }
}

// 处理 OAuth 回调
async function handleOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    
    if (error) {
        updateOAuthStatus('error', `授权失败: ${error}`);
        // 清理 URL 参数
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }
    
    if (!code || !state) {
        return; // 不是 OAuth 回调
    }
    
    // 验证 state
    const savedState = sessionStorage.getItem('oauth_state');
    if (state !== savedState) {
        updateOAuthStatus('error', 'State 验证失败，可能存在安全风险');
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }
    
    sessionStorage.removeItem('oauth_state');
    
    // 显示状态
    updateOAuthStatus('loading', '正在获取访问令牌...');
    
    try {
        // 确保获取 clientSecret
        let clientSecret = config.clientSecret;
        if (!clientSecret) {
            clientSecret = document.getElementById('clientSecret').value.trim();
            if (clientSecret) {
                config.clientSecret = clientSecret;
                localStorage.setItem('teslaDashConfig', JSON.stringify(config));
            }
        }
        
        if (!clientSecret) {
            throw new Error('Client Secret 未设置，请先填写并保存配置');
        }
        
        console.log('交换 token - Client ID:', config.clientId ? config.clientId.substring(0, 10) + '...' : '未设置');
        console.log('交换 token - Client Secret:', clientSecret ? '已设置（长度: ' + clientSecret.length + '）' : '未设置');
        console.log('交换 token - Code:', code ? code.substring(0, 10) + '...' : '未设置');
        console.log('交换 token - Redirect URI:', config.redirectUri);
        
        // 交换 access token
        const tokenParams = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: config.clientId,
            client_secret: clientSecret,
            code: code,
            redirect_uri: config.redirectUri
        });
        
        console.log('Token 请求参数:', {
            grant_type: 'authorization_code',
            client_id: config.clientId ? config.clientId.substring(0, 10) + '...' : '未设置',
            client_secret: '***',
            code: code ? code.substring(0, 10) + '...' : '未设置',
            redirect_uri: config.redirectUri
        });
        
        const response = await fetch(`${TESLA_AUTH_BASE}/oauth2/v3/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: tokenParams
        });
        
        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`获取 token 失败: ${response.status} - ${errorData}`);
        }
        
        const data = await response.json();
        
        // 保存 token
        config.apiToken = data.access_token;
        config.refreshToken = data.refresh_token;
        config.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
        
        // 保存 client secret（如果还没有）
        if (!config.clientSecret) {
            config.clientSecret = document.getElementById('clientSecret').value.trim();
        }
        
        localStorage.setItem('teslaDashConfig', JSON.stringify(config));
        document.getElementById('apiToken').value = config.apiToken;
        
        updateOAuthStatus('success', '登录成功！正在获取车辆列表...');
        
        // 清理 URL 参数
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // 自动获取车辆列表
        await fetchVehicles();
        
    } catch (error) {
        console.error('OAuth 回调处理失败:', error);
        updateOAuthStatus('error', `错误: ${error.message}`);
    }
}

// 获取车辆列表
async function fetchVehicles() {
    if (!config.apiToken) {
        alert('请先登录或输入 Access Token');
        return;
    }
    
    try {
        updateOAuthStatus('loading', '正在获取车辆列表...');
        
        const response = await fetch(`${TESLA_API_BASE}/api/1/vehicles`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${config.apiToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`获取车辆列表失败: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.response && data.response.length > 0) {
            // 如果只有一辆车，自动选择
            if (data.response.length === 1) {
                config.vehicleId = data.response[0].id;
                document.getElementById('vehicleId').value = config.vehicleId;
                localStorage.setItem('teslaDashConfig', JSON.stringify(config));
                updateOAuthStatus('success', `已选择车辆: ${data.response[0].display_name || data.response[0].id}`);
                startUpdates();
            } else {
                // 多辆车，让用户选择
                const vehicleList = data.response.map(v => 
                    `${v.display_name || v.vin} (ID: ${v.id})`
                ).join('\n');
                const selected = prompt(`找到 ${data.response.length} 辆车，请输入车辆 ID:\n\n${vehicleList}`);
                if (selected) {
                    const vehicle = data.response.find(v => v.id.toString() === selected || v.id === selected);
                    if (vehicle) {
                        config.vehicleId = vehicle.id;
                        document.getElementById('vehicleId').value = config.vehicleId;
                        localStorage.setItem('teslaDashConfig', JSON.stringify(config));
                        updateOAuthStatus('success', `已选择车辆: ${vehicle.display_name || vehicle.id}`);
                        startUpdates();
                    } else {
                        updateOAuthStatus('error', '无效的车辆 ID');
                    }
                }
            }
        } else {
            updateOAuthStatus('error', '未找到车辆');
        }
        
    } catch (error) {
        console.error('获取车辆列表失败:', error);
        updateOAuthStatus('error', `错误: ${error.message}`);
    }
}

// 更新 OAuth 状态显示
function updateOAuthStatus(type, message) {
    const statusDiv = document.getElementById('oauthStatus');
    statusDiv.className = `oauth-status oauth-${type}`;
    statusDiv.textContent = message;
}

// 生成随机字符串
function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 获取车辆数据
async function fetchVehicleData() {
    try {
        // 检查 token 是否过期
        if (isTokenExpired()) {
            await refreshAccessToken();
            return;
        }
        
        updateConnectionStatus('connecting', '连接中...');
        
        const response = await fetch(
            `${TESLA_API_BASE}/api/1/vehicles/${config.vehicleId}/vehicle_data`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${config.apiToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (response.status === 401) {
            // Token 过期，尝试刷新
            await refreshAccessToken();
            return;
        }
        
        if (!response.ok) {
            throw new Error(`API 错误: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.response) {
            updateDashboard(data.response);
            updateConnectionStatus('connected', '已连接');
            updateLastUpdateTime();
        } else {
            throw new Error('无效的响应数据');
        }
        
    } catch (error) {
        console.error('获取车辆数据失败:', error);
        updateConnectionStatus('error', `错误: ${error.message}`);
    }
}

// 更新仪表盘
function updateDashboard(vehicleData) {
    // 更新速度
    const speed = vehicleData.drive_state?.speed || 0;
    updateSpeed(speed);
    
    // 更新电池信息
    const chargeState = vehicleData.charge_state;
    if (chargeState) {
        const batteryLevel = chargeState.battery_level || 0;
        const chargingState = chargeState.charging_state || 'Unknown';
        
        document.getElementById('batteryLevel').textContent = `${batteryLevel}%`;
        document.getElementById('chargingState').textContent = 
            chargingState === 'Charging' ? '充电中' : 
            chargingState === 'Disconnected' ? '未连接' : 
            chargingState === 'Complete' ? '已完成' : '待机';
    }
    
    // 更新里程
    const odometer = vehicleData.vehicle_state?.odometer;
    if (odometer) {
        document.getElementById('odometer').textContent = `${odometer.toFixed(1)} km`;
    }
}

// 更新速度显示
function updateSpeed(speed) {
    // 更新数字显示
    const speedValue = Math.round(speed || 0);
    document.getElementById('speedValue').textContent = speedValue;
    
    // 更新速度表盘
    updateSpeedometer(speedValue);
}

// 更新速度表盘
function updateSpeedometer(speed) {
    // 计算角度 (-135 到 135 度)
    const maxSpeed = speedometerMaxSpeed;
    const percentage = Math.min(speed / maxSpeed, 1);
    const angle = -135 + (percentage * 270);
    
    // 更新指针
    const needle = document.getElementById('speedNeedle');
    needle.setAttribute('transform', `rotate(${angle} 200 150)`);
    
    // 更新弧线
    const circumference = Math.PI * 150; // 半圆周长
    const offset = circumference * (1 - percentage);
    const speedArc = document.getElementById('speedArc');
    speedArc.setAttribute('stroke-dashoffset', offset);
    
    // 根据速度改变颜色
    let color = '#00ff00'; // 绿色
    if (speed > 120) {
        color = '#ff0000'; // 红色
    } else if (speed > 80) {
        color = '#ffaa00'; // 橙色
    }
    
    speedArc.setAttribute('stroke', color);
    document.getElementById('speedValue').style.color = color;
    document.getElementById('speedValue').style.textShadow = 
        `0 0 20px ${color}80, 0 0 40px ${color}50`;
}

// 更新连接状态
function updateConnectionStatus(status, message) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    statusDot.className = 'status-dot';
    
    if (status === 'connected') {
        statusDot.classList.add('connected');
        statusText.textContent = '已连接';
    } else if (status === 'error') {
        statusDot.classList.add('error');
        statusText.textContent = message;
    } else {
        statusText.textContent = message;
    }
}

// 更新最后更新时间
function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('zh-CN');
    document.getElementById('lastUpdate').textContent = `最后更新: ${timeString}`;
}

// 页面可见性变化时暂停/恢复更新
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        if (updateTimer) {
            clearInterval(updateTimer);
            updateTimer = null;
        }
    } else {
        if (!updateTimer && config.apiToken && config.vehicleId) {
            startUpdates();
        }
    }
});

