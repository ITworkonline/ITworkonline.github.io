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
    partnerToken: '', // Partner Authentication Token (用于注册)
    partnerTokenExpiresAt: 0,
    vehicleId: '',
    vin: '', // 车辆 VIN（用于 Fleet Telemetry）
    telemetryUrl: '', // Fleet Telemetry 服务器 URL（HTTP）
    websocketUrl: '' // Fleet Telemetry WebSocket URL（wss://，用于配置车辆）
};

let updateTimer = null;
let isFetching = false; // 防止并发请求
let lastFetchTime = 0; // 上次请求时间
const MIN_FETCH_INTERVAL = 2000; // 最小请求间隔（2秒）

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    loadConfig();
    
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
    
    // 检查 URL 中是否有 OAuth 回调参数（延迟执行，确保 DOM 已加载）
    setTimeout(() => {
        handleOAuthCallback();
    }, 100);
    
    // 如果配置了 Telemetry，自动开始更新（延迟启动，避免在页面加载时立即请求）
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.get('code') && !urlParams.get('error')) {
        if (config.telemetryUrl && config.vin) {
            // 延迟启动，避免在 OAuth 回调处理过程中启动
            setTimeout(() => {
                if (!updateTimer) {
                    startUpdates();
                }
            }, 2000);
        }
    }
});

// 加载配置
function loadConfig() {
    const savedConfig = localStorage.getItem('teslaDashConfig');
    if (savedConfig) {
        const saved = JSON.parse(savedConfig);
        config = { ...config, ...saved };
        
        // 填充表单（安全地访问可能不存在的元素）
        const clientIdInput = document.getElementById('clientId');
        if (clientIdInput) clientIdInput.value = config.clientId || '';
        
        const clientSecretInput = document.getElementById('clientSecret');
        if (clientSecretInput) clientSecretInput.value = config.clientSecret || '';
        
        const redirectUriInput = document.getElementById('redirectUri');
        if (redirectUriInput) redirectUriInput.value = config.redirectUri || window.location.origin + window.location.pathname;
        
        const apiTokenInput = document.getElementById('apiToken');
        if (apiTokenInput) apiTokenInput.value = config.apiToken || '';
        
        const vehicleIdInput = document.getElementById('vehicleId');
        if (vehicleIdInput) vehicleIdInput.value = config.vehicleId || '';
        
        const updateIntervalInput = document.getElementById('updateInterval');
        if (updateIntervalInput) updateIntervalInput.value = config.updateInterval || 2;
        const proxyInput = document.getElementById('proxyUrl');
        if (proxyInput) {
            proxyInput.value = config.proxyUrl || '';
        }
        const telemetryInput = document.getElementById('telemetryUrl');
        if (telemetryInput) {
            telemetryInput.value = config.telemetryUrl || '';
        }
        const vinInput = document.getElementById('vin');
        if (vinInput) {
            vinInput.value = config.vin || '';
        }
    }
}

// 保存配置
function saveConfig() {
    // 保存代理 URL
    const proxyInput = document.getElementById('proxyUrl');
    if (proxyInput) {
        config.proxyUrl = proxyInput.value.trim();
        // 自动添加 https:// 协议（如果没有）
        if (config.proxyUrl && !config.proxyUrl.startsWith('http://') && !config.proxyUrl.startsWith('https://')) {
            config.proxyUrl = 'https://' + config.proxyUrl;
            proxyInput.value = config.proxyUrl;
        }
    }
    
    const telemetryInput = document.getElementById('telemetryUrl');
    if (telemetryInput) {
        config.telemetryUrl = telemetryInput.value.trim();
        // 自动添加 https:// 协议（如果没有）
        if (config.telemetryUrl && !config.telemetryUrl.startsWith('http://') && !config.telemetryUrl.startsWith('https://')) {
            config.telemetryUrl = 'https://' + config.telemetryUrl;
            telemetryInput.value = config.telemetryUrl;
        }
    }
    const vinInput = document.getElementById('vin');
    if (vinInput) {
        config.vin = vinInput.value.trim();
    }
    const websocketInput = document.getElementById('websocketUrl');
    if (websocketInput) {
        config.websocketUrl = websocketInput.value.trim();
        // 如果 websocketUrl 为空，但 telemetryUrl 有值，自动生成
        if (!config.websocketUrl && config.telemetryUrl) {
            const wsUrl = config.telemetryUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/telemetry';
            config.websocketUrl = wsUrl;
            websocketInput.value = wsUrl;
        }
        // 确保 WebSocket URL 有正确的协议前缀和路径
        if (config.websocketUrl && !config.websocketUrl.startsWith('wss://') && !config.websocketUrl.startsWith('ws://')) {
            config.websocketUrl = 'wss://' + config.websocketUrl;
            // 如果没有 /telemetry 路径，自动添加
            if (!config.websocketUrl.endsWith('/telemetry')) {
                config.websocketUrl = config.websocketUrl.replace(/\/$/, '') + '/telemetry';
            }
            websocketInput.value = config.websocketUrl;
        } else if (config.websocketUrl && (config.websocketUrl.startsWith('wss://') || config.websocketUrl.startsWith('ws://'))) {
            // 如果有协议但没有路径，添加 /telemetry
            if (!config.websocketUrl.endsWith('/telemetry') && !config.websocketUrl.match(/\/telemetry$/)) {
                config.websocketUrl = config.websocketUrl.replace(/\/$/, '') + '/telemetry';
                websocketInput.value = config.websocketUrl;
            }
        }
    }
    
    // 保存更新间隔
    const updateIntervalInput = document.getElementById('updateInterval');
    if (updateIntervalInput) {
        const intervalValue = parseInt(updateIntervalInput.value) || 2;
        config.updateInterval = Math.max(1, Math.min(60, intervalValue)); // 限制在 1-60 秒之间
        updateIntervalInput.value = config.updateInterval;
    }
    
    localStorage.setItem('teslaDashConfig', JSON.stringify(config));
    
    // 重新开始更新（如果正在运行）
    if (updateTimer) {
        clearInterval(updateTimer);
        updateTimer = null;
        // 使用新的间隔重新启动
        const urlParams = new URLSearchParams(window.location.search);
        const isOAuthCallback = urlParams.get('code') || urlParams.get('error');
        if (!isOAuthCallback) {
            setTimeout(() => {
                startUpdates();
            }, 500);
        }
    } else {
        // 只有在配置了 Telemetry 且不在 OAuth 回调过程中时才自动启动
        const urlParams = new URLSearchParams(window.location.search);
        const isOAuthCallback = urlParams.get('code') || urlParams.get('error');
        
        if (config.telemetryUrl && config.vin && !isOAuthCallback) {
            // 延迟启动，避免在保存配置时立即启动
            setTimeout(() => {
                startUpdates();
            }, 1000);
        }
    }
    
    toggleConfig();
    alert('配置已保存！');
}

// 配置车辆 Fleet Telemetry
async function configureFleetTelemetry() {
    const statusDiv = document.getElementById('telemetryConfigStatus');
    statusDiv.style.display = 'block';
    statusDiv.textContent = '正在配置...';
    statusDiv.style.background = '#333';
    statusDiv.style.color = '#fff';
    
    try {
        // 检查必要配置
        if (!config.vin) {
            throw new Error('请先填写车辆 VIN');
        }
        
        // 确保 telemetryUrl 有正确的协议
        if (config.telemetryUrl && !config.telemetryUrl.startsWith('http://') && !config.telemetryUrl.startsWith('https://')) {
            config.telemetryUrl = 'https://' + config.telemetryUrl;
        }
        
        if (!config.websocketUrl) {
            // 尝试从 telemetryUrl 生成
            if (config.telemetryUrl) {
                config.websocketUrl = config.telemetryUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/telemetry';
            } else {
                throw new Error('请填写 WebSocket URL 或 Telemetry 服务器 URL');
            }
        }
        
        // 确保 WebSocket URL 有正确的协议前缀和路径
        if (!config.websocketUrl.startsWith('wss://') && !config.websocketUrl.startsWith('ws://')) {
            // 如果没有协议，添加 wss://
            config.websocketUrl = 'wss://' + config.websocketUrl;
        }
        // 确保有 /telemetry 路径
        if (!config.websocketUrl.endsWith('/telemetry')) {
            config.websocketUrl = config.websocketUrl.replace(/\/$/, '') + '/telemetry';
        }
        
        // 检查是否有 API Token（用于调用 Fleet API）
        if (!config.apiToken) {
            statusDiv.textContent = '⚠️ 需要 API Token 来配置车辆。请先通过 OAuth 登录获取 Token。';
            statusDiv.style.background = '#ffaa00';
            statusDiv.style.color = '#000';
            return;
        }
        
        // 检查 token 是否过期，如果过期则先刷新
        if (isTokenExpired()) {
            statusDiv.textContent = 'Token 已过期，正在刷新...';
            statusDiv.style.background = '#333';
            statusDiv.style.color = '#fff';
            try {
                // 传递 skipTimerCheck=true 以便在配置时也能刷新 token
                await refreshAccessToken(true);
                // 刷新后重新加载配置
                const savedConfig = localStorage.getItem('teslaDashConfig');
                if (savedConfig) {
                    const saved = JSON.parse(savedConfig);
                    config = { ...config, ...saved };
                }
                statusDiv.textContent = 'Token 刷新成功，继续配置...';
            } catch (refreshError) {
                statusDiv.textContent = '❌ Token 刷新失败，请重新登录';
                statusDiv.style.background = '#ff0000';
                statusDiv.style.color = '#fff';
                throw new Error('Token 刷新失败: ' + refreshError.message);
            }
        }
        
        // 检查是否有 Vehicle ID
        if (!config.vehicleId) {
            statusDiv.textContent = '⚠️ 需要 Vehicle ID。请先获取车辆列表。';
            statusDiv.style.background = '#ffaa00';
            statusDiv.style.color = '#000';
            return;
        }
        
        console.log('配置 Fleet Telemetry...');
        console.log('Vehicle ID:', config.vehicleId);
        console.log('VIN:', config.vin);
        console.log('WebSocket URL:', config.websocketUrl);
        
        // 调用 fleet_telemetry_config 端点
        // 注意：根据文档，新应用可能需要通过 vehicle-command proxy 调用
        // 先尝试使用 /command/fleet_telemetry_config 端点（新应用）
        // 如果失败，再尝试 /fleet_telemetry_config 端点（旧应用）
        let url = `${TESLA_API_BASE}/api/1/vehicles/${config.vehicleId}/command/fleet_telemetry_config`;
        let apiUrl = config.proxyUrl 
            ? `${config.proxyUrl}?url=${encodeURIComponent(url)}`
            : url;
        
        console.log('尝试配置 Fleet Telemetry (使用 command 端点)...');
        let response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                websocket_url: config.websocketUrl,
                fields: [4, 5, 42] // VehicleSpeed, Odometer, BatteryLevel
            })
        });
        
        // 如果 command 端点失败（404 或 405），尝试旧端点
        if (response.status === 404 || response.status === 405) {
            console.log('command 端点不可用，尝试使用旧端点...');
            url = `${TESLA_API_BASE}/api/1/vehicles/${config.vehicleId}/fleet_telemetry_config`;
            apiUrl = config.proxyUrl 
                ? `${config.proxyUrl}?url=${encodeURIComponent(url)}`
                : url;
            
            response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    websocket_url: config.websocketUrl,
                    fields: [4, 5, 42] // VehicleSpeed, Odometer, BatteryLevel
                })
            });
        }
        
        if (!response.ok) {
            let errorData;
            let errorText = '';
            try {
                const text = await response.text();
                errorText = text;
                try {
                    errorData = JSON.parse(text);
                } catch (parseError) {
                    // 如果不是 JSON，可能是 HTML 错误页面
                    errorData = { 
                        error: 'Proxy request failed',
                        message: text.substring(0, 100) + '...' // 只显示前100个字符
                    };
                }
            } catch (e) {
                errorData = { error: 'Unknown error', message: e.message };
            }
            
            // 根据状态码提供更友好的错误信息
            let errorMessage = `配置失败: ${response.status}`;
            if (response.status === 500) {
                errorMessage += '\n\n服务器内部错误。可能原因：\n1. 代理服务器配置问题\n2. Tesla API 暂时不可用\n3. 请求格式不正确\n4. 新应用需要使用 vehicle-command proxy（需要私钥签名）\n\n建议：\n1. 检查代理服务器是否正常运行\n2. 查看完整错误信息（下方）\n3. 如果是新应用，可能需要部署 vehicle-command proxy 服务器\n4. 查看 Tesla 开发者文档了解最新要求';
            } else if (response.status === 401) {
                errorMessage += '\n\n认证失败。Token 可能已过期，请重新登录。';
            } else if (response.status === 400) {
                errorMessage += '\n\n请求参数错误。请检查 WebSocket URL 格式是否正确。';
            } else if (response.status === 404) {
                errorMessage += '\n\n端点不存在。可能是：\n1. Vehicle ID 不正确\n2. 应用类型不支持此端点\n3. 需要使用 vehicle-command proxy';
            }
            
            if (errorData.error) {
                errorMessage += `\n\n错误详情: ${errorData.error}`;
            }
            if (errorData.message) {
                errorMessage += `\n消息: ${errorData.message}`;
            }
            
            // 显示完整的错误响应（用于调试）
            if (errorText && errorText.length < 500) {
                errorMessage += `\n\n完整响应:\n${errorText}`;
            }
            
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        console.log('Fleet Telemetry 配置响应:', data);
        
        if (data.response) {
            statusDiv.textContent = `✅ 配置成功！状态: ${data.response.synced ? '已同步' : '同步中...'}`;
            statusDiv.style.background = '#00ff00';
            statusDiv.style.color = '#000';
            
            if (!data.response.synced) {
                statusDiv.textContent += '\n⚠️ 请等待同步完成（synced: true）';
            }
        } else {
            throw new Error('无效的响应数据');
        }
        
    } catch (error) {
        console.error('配置 Fleet Telemetry 失败:', error);
        statusDiv.textContent = `❌ 配置失败: ${error.message}`;
        statusDiv.style.background = '#ff0000';
        statusDiv.style.color = '#fff';
        
        // 如果是 400/401 错误，提示可能需要 vehicle-command proxy
        if (error.message.includes('400') || error.message.includes('401')) {
            statusDiv.textContent += '\n\n提示：新应用可能需要通过 vehicle-command proxy 调用此端点。\n请参考 FLEET_TELEMETRY_COMPLETE_SETUP.md 文档。';
        }
    }
}

// 切换配置面板 - 确保全局可用
function toggleConfig() {
    const panel = document.getElementById('configPanel');
    if (panel) {
        panel.classList.toggle('show');
    } else {
        console.error('配置面板元素未找到');
    }
}

// 确保函数在全局作用域中可用
window.toggleConfig = toggleConfig;
window.saveConfig = saveConfig;
window.configureFleetTelemetry = configureFleetTelemetry;
window.startOAuthLogin = startOAuthLogin;

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
    // 如果已经有定时器在运行，先清除旧的
    if (updateTimer) {
        if (typeof updateTimer === 'object' && updateTimer.stop) {
            updateTimer.stop();
        } else if (typeof updateTimer === 'number') {
            clearTimeout(updateTimer);
        } else {
            clearInterval(updateTimer);
        }
        updateTimer = null;
    }
    
    // 如果使用 Telemetry，不需要 API Token 和 Vehicle ID
    if (!config.telemetryUrl || !config.vin) {
        if (!config.apiToken || !config.vehicleId) {
            updateConnectionStatus('error', '请先配置 API Token 和 Vehicle ID，或配置 Telemetry 服务器 URL 和 VIN');
            return;
        }
    }
    
    // 重置失败计数
    if (!window.telemetryFailCount) {
        window.telemetryFailCount = 0;
    }
    
    // 计算实际更新间隔（考虑失败次数）
    function getActualInterval() {
        const baseIntervalSeconds = Math.max(config.updateInterval || 2, 1);
        // 如果失败次数多，增加间隔（最多增加到 30 秒）
        const failCount = window.telemetryFailCount || 0;
        if (failCount > 5) {
            // 失败超过 5 次，使用更长的间隔（10-30 秒）
            const extendedInterval = Math.min(10 + (failCount - 5) * 2, 30);
            return extendedInterval * 1000;
        }
        return Math.max(baseIntervalSeconds * 1000, 1000); // 最小 1 秒
    }
    
    // 使用一个对象来存储运行状态和定时器 ID
    const timerState = {
        isRunning: true,
        currentTimeout: null,
        stop: function() {
            this.isRunning = false;
            if (this.currentTimeout) {
                clearTimeout(this.currentTimeout);
                this.currentTimeout = null;
            }
        }
    };
    
    // 设置定时更新（使用动态间隔）
    function scheduleNext() {
        if (!timerState.isRunning) return;
        
        const actualInterval = getActualInterval();
        timerState.currentTimeout = setTimeout(async () => {
            if (!timerState.isRunning) return;
            
            try {
                await fetchVehicleData();
            } catch (error) {
                console.error('获取数据失败:', error);
            } finally {
                // 递归调度下一次
                scheduleNext();
            }
        }, actualInterval);
    }
    
    // 立即执行一次（延迟一下，避免在页面加载时立即请求）
    setTimeout(async () => {
        if (timerState.isRunning) {
            try {
                await fetchVehicleData();
            } catch (error) {
                console.error('首次获取数据失败:', error);
            }
            // 开始定时更新
            scheduleNext();
        }
    }, 500);
    
    // 保存定时器状态对象
    updateTimer = timerState;
    
    console.log('✅ 开始更新数据，基础间隔:', (config.updateInterval || 2), '秒');
    
    // 更新按钮状态
    updateControlButtons(true);
}

// 停止更新
function stopUpdates() {
    console.log('停止更新 - 当前 updateTimer:', updateTimer);
    
    if (updateTimer) {
        // 如果是对象（新的实现），调用 stop 方法
        if (typeof updateTimer === 'object' && updateTimer.stop) {
            updateTimer.stop();
        }
        // 如果是数字（setTimeout ID），清除它
        else if (typeof updateTimer === 'number') {
            clearTimeout(updateTimer);
        }
        // 如果是旧的 setInterval，清除它
        else if (typeof updateTimer === 'object') {
            clearInterval(updateTimer);
        }
        updateTimer = null;
        console.log('定时器已清除');
    }
    
    // 重置失败计数
    window.telemetryFailCount = 0;
    
    // 更新按钮状态
    updateControlButtons(false);
    updateConnectionStatus('paused', '已暂停读取');
    
    console.log('更新已停止，updateTimer:', updateTimer);
}

// 切换更新状态
function toggleUpdates() {
    console.log('toggleUpdates 被调用，当前 updateTimer:', updateTimer);
    
    if (updateTimer) {
        console.log('停止更新...');
        stopUpdates();
    } else {
        console.log('开始更新...');
        startUpdates();
    }
}

// 更新控制按钮显示状态
function updateControlButtons(isRunning) {
    const stopBtn = document.getElementById('stopBtn');
    const startBtn = document.getElementById('startBtn');
    
    if (isRunning) {
        stopBtn.style.display = 'flex';
        startBtn.style.display = 'none';
    } else {
        stopBtn.style.display = 'none';
        startBtn.style.display = 'flex';
    }
}

// 检查 token 是否过期
function isTokenExpired() {
    if (!config.tokenExpiresAt) return true;
    return Date.now() >= config.tokenExpiresAt - 60000; // 提前 1 分钟刷新
}

// 获取 Partner Authentication Token (使用 client_credentials)
async function getPartnerToken() {
    if (!config.clientId || !config.clientSecret) {
        throw new Error('缺少 Client ID 或 Client Secret');
    }

    // 检查 token 是否过期
    if (config.partnerToken && config.partnerTokenExpiresAt && Date.now() < config.partnerTokenExpiresAt - 60000) {
        return config.partnerToken;
    }

    try {
        console.log('获取 Partner Authentication Token...');
        const response = await fetch(`${TESLA_AUTH_BASE}/oauth2/v3/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: config.clientId,
                client_secret: config.clientSecret,
                audience: TESLA_API_BASE
            })
        });

        if (!response.ok) {
            const errorData = await response.text().catch(() => '无法读取错误信息');
            throw new Error(`获取 Partner Token 失败: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        config.partnerToken = data.access_token;
        config.partnerTokenExpiresAt = Date.now() + (data.expires_in * 1000);
        
        localStorage.setItem('teslaDashConfig', JSON.stringify(config));
        console.log('Partner Token 获取成功');
        
        return config.partnerToken;
    } catch (error) {
        console.error('获取 Partner Token 失败:', error);
        throw error;
    }
}

// 注册账户到区域
async function registerPartnerAccount() {
    try {
        console.log('注册账户到区域...');
        
        // 获取 Partner Token
        const partnerToken = await getPartnerToken();
        
        // 重新加载配置，确保获取最新的 proxyUrl
        const savedConfig = localStorage.getItem('teslaDashConfig');
        if (savedConfig) {
            const saved = JSON.parse(savedConfig);
            config = { ...config, ...saved };
        }
        
        // 构建 API URL（使用代理或直接调用）
        const targetUrl = `${TESLA_API_BASE}/api/1/partner_accounts`;
        const apiUrl = config.proxyUrl 
            ? `${config.proxyUrl}?url=${encodeURIComponent(targetUrl)}`
            : targetUrl;
        
        // 从 redirectUri 提取域名（例如：https://blog.itworkonline.top/dash -> blog.itworkonline.top）
        let domain = '';
        try {
            const redirectUriObj = new URL(config.redirectUri || window.location.origin);
            domain = redirectUriObj.hostname;
        } catch (e) {
            // 如果无法解析，使用当前页面的域名
            domain = window.location.hostname;
        }
        
        console.log('注册账户 - 使用域名:', domain);
        
        // 构建请求体（包含 domain 参数）
        const requestBody = {
            domain: domain
        };
        
        const fetchOptions = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${partnerToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(requestBody)
        };
        
        console.log('注册请求:', {
            url: apiUrl,
            method: 'POST',
            headers: fetchOptions.headers,
            body: requestBody,
            bodyString: JSON.stringify(requestBody)
        });
        
        const response = await fetch(apiUrl, fetchOptions);

        if (!response.ok) {
            const errorData = await response.text().catch(() => '无法读取错误信息');
            throw new Error(`注册账户失败: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        console.log('账户注册成功:', data);
        return data;
    } catch (error) {
        console.error('注册账户失败:', error);
        throw error;
    }
}

// 刷新 access token
async function refreshAccessToken(skipTimerCheck = false) {
    // 如果定时器已停止且不是配置调用，不刷新 token
    if (!skipTimerCheck && !updateTimer) {
        console.log('refreshAccessToken: 定时器已停止，取消 token 刷新');
        return;
    }
    
    if (!config.refreshToken || !config.clientId || !config.clientSecret) {
        if (skipTimerCheck) {
            throw new Error('缺少刷新 token 或 OAuth 配置，请重新登录');
        }
        updateConnectionStatus('error', '缺少刷新 token 或 OAuth 配置');
        return;
    }

    try {
        let response;
        try {
            response = await fetch(`${TESLA_AUTH_BASE}/oauth2/v3/token`, {
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
        } catch (fetchError) {
            console.error('刷新 token 的 Fetch 错误:', fetchError);
            throw new Error(`网络请求失败: ${fetchError.message}`);
        }

        if (!response.ok) {
            const errorData = await response.text().catch(() => '无法读取错误信息');
            throw new Error(`Token 刷新失败: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        config.apiToken = data.access_token;
        config.refreshToken = data.refresh_token || config.refreshToken;
        config.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
        
        localStorage.setItem('teslaDashConfig', JSON.stringify(config));
        // 尝试更新 apiToken 输入框（如果存在）
        try {
            const apiTokenInput = document.getElementById('apiToken');
            if (apiTokenInput) {
                apiTokenInput.value = config.apiToken;
            }
        } catch (e) {
            // 输入框不存在也没关系，继续执行
            console.log('apiToken 输入框不存在，跳过更新');
        }
        
        // 只有在有定时器时才启动更新（避免在配置时启动）
        if (updateTimer) {
            startUpdates();
        }
    } catch (error) {
        console.error('刷新 token 失败:', error);
        updateConnectionStatus('error', 'Token 已过期，请重新登录');
    }
}

// 启动 OAuth 登录
function startOAuthLogin() {
    try {
        console.log('=== 开始 OAuth 登录流程 ===');
        
        const clientIdInput = document.getElementById('clientId');
        const redirectUriInput = document.getElementById('redirectUri');
        const clientSecretInput = document.getElementById('clientSecret');
        
        if (!clientIdInput || !redirectUriInput || !clientSecretInput) {
            console.error('找不到必要的输入元素');
            alert('错误：找不到配置输入框，请刷新页面重试');
            return;
        }
        
        const clientId = clientIdInput.value.trim();
        const redirectUri = redirectUriInput.value.trim();
        const clientSecret = clientSecretInput.value.trim();
        
        console.log('Client ID:', clientId ? clientId.substring(0, 10) + '...' : '未填写');
        console.log('Redirect URI:', redirectUri);
        console.log('Client Secret:', clientSecret ? '已填写（长度: ' + clientSecret.length + '）' : '未填写');
        console.log('Auth Base:', TESLA_AUTH_BASE);
        
        // 验证所有必填字段
        if (!clientId) {
            alert('请先填写 Client ID');
            updateOAuthStatus('error', '请先填写 Client ID');
            clientIdInput.focus();
            return;
        }
        
        if (!redirectUri) {
            alert('请先填写 Redirect URI');
            updateOAuthStatus('error', '请先填写 Redirect URI');
            redirectUriInput.focus();
            return;
        }
        
        if (!clientSecret) {
            alert('请先填写 Client Secret！\n\n这是必需的，用于 OAuth 认证。');
            updateOAuthStatus('error', '请先填写 Client Secret');
            clientSecretInput.focus();
            return;
        }
        
        // 验证 Redirect URI 格式
        let redirectUriObj;
        try {
            redirectUriObj = new URL(redirectUri);
        } catch (e) {
            alert('Redirect URI 格式不正确，请使用完整的 URL（例如：https://blog.itworkonline.top/dash）\n\n错误: ' + e.message);
            updateOAuthStatus('error', 'Redirect URI 格式不正确');
            redirectUriInput.focus();
            return;
        }
        
        // 确保使用 HTTPS（生产环境）
        if (redirectUriObj.protocol !== 'https:' && window.location.protocol === 'https:') {
            const useHttps = confirm('Redirect URI 使用的是 ' + redirectUriObj.protocol + ' 协议，但当前页面使用 HTTPS。\n\n建议使用 HTTPS 协议以确保安全。\n\n是否继续？');
            if (!useHttps) {
                return;
            }
        }
        
        // 保存配置（包括 clientSecret）
        config.clientId = clientId;
        config.clientSecret = clientSecret;
        config.redirectUri = redirectUri;
        localStorage.setItem('teslaDashConfig', JSON.stringify(config));
        
        console.log('✅ 配置已保存');
        
        // 生成 state 参数（用于防止 CSRF 攻击）
        const state = generateRandomString(32);
        sessionStorage.setItem('oauth_state', state);
        console.log('✅ State 已生成:', state.substring(0, 10) + '...');
        
        // 构建授权 URL
        const authUrl = new URL(`${TESLA_AUTH_BASE}/oauth2/v3/authorize`);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'openid offline_access vehicle_device_data vehicle_cmds');
        authUrl.searchParams.set('state', state);
        
        const finalAuthUrl = authUrl.toString();
        console.log('✅ 授权 URL 已构建:', finalAuthUrl);
        updateOAuthStatus('loading', '正在跳转到 Tesla 登录页面...');
        
        // 延迟一下，确保状态更新显示
        setTimeout(() => {
            console.log('🚀 开始跳转到 Tesla 登录页面...');
            window.location.href = finalAuthUrl;
        }, 100);
        
    } catch (error) {
        console.error('❌ OAuth 登录错误:', error);
        console.error('错误堆栈:', error.stack);
        alert('登录失败: ' + error.message + '\n\n请查看浏览器控制台获取详细信息。');
        updateOAuthStatus('error', '错误: ' + error.message);
    }
}

// 处理 OAuth 回调
async function handleOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    
    // 如果有 OAuth 回调参数，自动打开配置面板
    if (code || state || error) {
        // 确保配置面板是打开的
        const configPanel = document.getElementById('configPanel');
        if (configPanel && !configPanel.classList.contains('show')) {
            configPanel.classList.add('show');
        }
    }
    
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
        // 重新加载配置，确保获取最新的 clientSecret
        const savedConfig = localStorage.getItem('teslaDashConfig');
        if (savedConfig) {
            const saved = JSON.parse(savedConfig);
            config = { ...config, ...saved };
        }
        
        // 确保获取 clientSecret（优先从配置，然后从输入框）
        let clientSecret = config.clientSecret;
        if (!clientSecret) {
            const secretInput = document.getElementById('clientSecret');
            if (secretInput) {
                clientSecret = secretInput.value.trim();
                if (clientSecret) {
                    config.clientSecret = clientSecret;
                    localStorage.setItem('teslaDashConfig', JSON.stringify(config));
                }
            }
        }
        
        // 验证必要的配置
        if (!config.clientId) {
            throw new Error('Client ID 未设置，请先填写并保存配置');
        }
        
        if (!clientSecret) {
            throw new Error('Client Secret 未设置！\n\n请在配置面板中填写 Client Secret，然后点击"保存配置"，再重新尝试登录。');
        }
        
        if (!config.redirectUri) {
            throw new Error('Redirect URI 未设置，请先填写并保存配置');
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
            redirect_uri: config.redirectUri,
            audience: TESLA_API_BASE  // 添加 audience 参数，指定 API 端点
        });
        
        console.log('Token 请求参数:', {
            grant_type: 'authorization_code',
            client_id: config.clientId ? config.clientId.substring(0, 10) + '...' : '未设置',
            client_secret: '***',
            code: code ? code.substring(0, 10) + '...' : '未设置',
            redirect_uri: config.redirectUri
        });
        
        console.log('发送 token 请求到:', `${TESLA_AUTH_BASE}/oauth2/v3/token`);
        
        let response;
        try {
            response = await fetch(`${TESLA_AUTH_BASE}/oauth2/v3/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: tokenParams
            });
        } catch (fetchError) {
            console.error('Fetch 错误详情:', fetchError);
            // 提供更详细的错误信息
            let errorMsg = '网络请求失败: ';
            if (fetchError.message.includes('Failed to fetch')) {
                errorMsg += '无法连接到 Tesla 服务器。\n\n可能的原因：\n';
                errorMsg += '1. 网络连接问题\n';
                errorMsg += '2. CORS 策略阻止（如果使用 file:// 协议）\n';
                errorMsg += '3. Tesla API 服务器暂时不可用\n';
                errorMsg += '4. 防火墙或代理设置阻止了请求\n\n';
                errorMsg += '请检查网络连接，或尝试使用 HTTPS 协议访问页面。';
            } else {
                errorMsg += fetchError.message;
            }
            throw new Error(errorMsg);
        }
        
        if (!response.ok) {
            let errorData;
            try {
                errorData = await response.text();
            } catch (e) {
                errorData = `无法读取错误响应: ${e.message}`;
            }
            
            console.error('Token 请求失败:', response.status, errorData);
            
            // 解析错误信息
            let errorMessage = `获取 token 失败 (${response.status})`;
            try {
                const errorJson = JSON.parse(errorData);
                if (errorJson.error_description) {
                    errorMessage += `: ${errorJson.error_description}`;
                } else if (errorJson.error) {
                    errorMessage += `: ${errorJson.error}`;
                }
            } catch (e) {
                errorMessage += `: ${errorData}`;
            }
            
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        
        // 保存 token
        config.apiToken = data.access_token;
        config.refreshToken = data.refresh_token;
        config.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
        
        // 保存 client secret（如果还没有）
        if (!config.clientSecret) {
            const clientSecretInput = document.getElementById('clientSecret');
            if (clientSecretInput) {
                config.clientSecret = clientSecretInput.value.trim();
            }
        }
        
        localStorage.setItem('teslaDashConfig', JSON.stringify(config));
        
        // 安全地更新 apiToken 输入框（如果存在）
        const apiTokenInput = document.getElementById('apiToken');
        if (apiTokenInput) {
            apiTokenInput.value = config.apiToken;
        }
        
        updateOAuthStatus('success', '登录成功！正在获取车辆列表...');
        
        // 清理 URL 参数
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // 自动获取车辆列表
        await fetchVehicles();
        
    } catch (error) {
        console.error('OAuth 回调处理失败:', error);
        
        // 确保配置面板是打开的
        const configPanel = document.getElementById('configPanel');
        if (configPanel && !configPanel.classList.contains('show')) {
            configPanel.classList.add('show');
        }
        
        // 显示详细的错误信息
        let errorMessage = error.message;
        
        // 处理不同类型的错误
        if (errorMessage.includes('CORS') || errorMessage.includes('Access-Control-Allow-Origin')) {
            errorMessage = 'CORS 错误：Tesla API 不允许直接从浏览器调用\n\n解决方案：\n1. 配置 CORS 代理服务器（推荐）\n   - 在配置面板的"其他设置"中填写"CORS 代理 URL"\n   - 可以使用 Vercel/Netlify 等免费服务部署代理\n   - 详细说明请查看 CORS_SOLUTION.md 文件\n\n2. 或者使用后端服务器处理 API 请求';
        } else if (errorMessage.includes('Failed to fetch') || errorMessage.includes('网络请求失败')) {
            errorMessage = '网络连接失败\n\n可能的原因：\n1. 网络连接问题\n2. Tesla API 服务器暂时不可用\n3. 防火墙或代理设置阻止了请求\n4. 浏览器安全策略限制\n\n请检查：\n- 网络连接是否正常\n- 是否能访问 https://auth.tesla.com\n- 是否配置了 CORS 代理 URL\n- 浏览器控制台是否有更多错误信息';
        } else if (errorMessage.includes('unauthorized_client')) {
            errorMessage = 'Client ID 和 Client Secret 组合无效\n\n请检查：\n1. Client Secret 是否正确填写\n2. Client ID 和 Client Secret 是否匹配\n3. 是否在 Tesla 开发者平台中正确配置';
        } else if (errorMessage.includes('CORS')) {
            errorMessage = 'CORS 错误：跨域请求被阻止\n\n请确保使用 HTTPS 协议访问页面，而不是 file:// 协议';
        }
        
        updateOAuthStatus('error', `错误: ${errorMessage}`);
        
        // 如果是 Client Secret 相关错误，聚焦到输入框
        if (errorMessage.includes('Client Secret')) {
            try {
                const secretInput = document.getElementById('clientSecret');
                if (secretInput) {
                    secretInput.focus();
                    // 高亮显示输入框
                    secretInput.style.borderColor = '#ff0000';
                    secretInput.style.boxShadow = '0 0 10px rgba(255, 0, 0, 0.5)';
                    setTimeout(() => {
                        if (secretInput) {
                            secretInput.style.borderColor = '';
                            secretInput.style.boxShadow = '';
                        }
                    }, 3000);
                }
            } catch (e) {
                console.warn('无法聚焦到 clientSecret 输入框:', e);
            }
        }
        
        // 清理 URL 参数
        window.history.replaceState({}, document.title, window.location.pathname);
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
        
        // 重新加载配置，确保获取最新的 proxyUrl
        const savedConfig = localStorage.getItem('teslaDashConfig');
        if (savedConfig) {
            const saved = JSON.parse(savedConfig);
            config = { ...config, ...saved };
        }
        
        // 如果还是没有 proxyUrl，尝试从输入框获取
        if (!config.proxyUrl) {
            const proxyInput = document.getElementById('proxyUrl');
            if (proxyInput && proxyInput.value.trim()) {
                config.proxyUrl = proxyInput.value.trim();
                localStorage.setItem('teslaDashConfig', JSON.stringify(config));
            }
        }
        
        console.log('获取车辆列表 - Proxy URL:', config.proxyUrl || '未设置');
        
        // 构建 API URL（使用代理或直接调用）
        const apiUrl = config.proxyUrl 
            ? `${config.proxyUrl}?url=${encodeURIComponent(`${TESLA_API_BASE}/api/1/vehicles`)}`
            : `${TESLA_API_BASE}/api/1/vehicles`;
        
        console.log('获取车辆列表 - API URL:', apiUrl);
        
        let response;
        try {
            const fetchOptions = {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${config.apiToken}`,
                    'Content-Type': 'application/json'
                }
            };
            
            // 如果使用代理，可能需要不同的请求格式
            if (config.proxyUrl) {
                // 代理服务器应该转发 Authorization 头
                response = await fetch(apiUrl, fetchOptions);
            } else {
                // 直接调用（可能被 CORS 阻止）
                response = await fetch(apiUrl, fetchOptions);
            }
        } catch (fetchError) {
            console.error('获取车辆列表的 Fetch 错误:', fetchError);
            throw new Error(`网络请求失败: ${fetchError.message}`);
        }
        
        if (!response.ok) {
            const errorData = await response.text().catch(() => '无法读取错误信息');
            let errorJson;
            try {
                errorJson = JSON.parse(errorData);
            } catch (e) {
                errorJson = { error: errorData };
            }
            
            console.log('API 响应错误:', {
                status: response.status,
                error: errorJson.error,
                fullError: errorJson
            });
            
            // 如果是 412 错误（需要注册），尝试自动注册
            if (response.status === 412) {
                const errorText = errorJson.error || errorData || '';
                const needsRegistration = errorText.includes('must be registered') || 
                                         errorText.includes('registered in the current region');
                
                console.log('检查 412 错误:', {
                    status: response.status,
                    errorText: errorText,
                    needsRegistration: needsRegistration
                });
                
                if (needsRegistration) {
                    console.log('检测到 412 错误，尝试自动注册账户...');
                    updateOAuthStatus('loading', '检测到需要注册账户，正在自动注册...');
                    
                    try {
                        await registerPartnerAccount();
                        updateOAuthStatus('success', '账户注册成功！正在重新获取车辆列表...');
                        
                        // 重新尝试获取车辆列表
                        return await fetchVehicles();
                    } catch (regError) {
                        console.error('自动注册失败:', regError);
                        throw new Error(`账户需要注册到区域。自动注册失败: ${regError.message}\n\n请确保你的应用在 Tesla 开发者平台中已正确配置，并且启用了 client-credentials grant type。`);
                    }
                }
            }
            
            throw new Error(`获取车辆列表失败: ${response.status} - ${errorData}`);
        }
        
        const data = await response.json();
        
        if (data.response && data.response.length > 0) {
            // 如果只有一辆车，自动选择
            if (data.response.length === 1) {
                config.vehicleId = data.response[0].id;
                const vehicleIdInput = document.getElementById('vehicleId');
                if (vehicleIdInput) vehicleIdInput.value = config.vehicleId;
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
                        const vehicleIdInput = document.getElementById('vehicleId');
                        if (vehicleIdInput) vehicleIdInput.value = config.vehicleId;
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
    if (statusDiv) {
        statusDiv.className = `oauth-status oauth-${type}`;
        statusDiv.textContent = message;
    } else {
        console.warn('oauthStatus 元素不存在，无法更新状态:', message);
    }
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

// 从 Fleet Telemetry 服务器获取所有车辆数据
async function fetchVehicleDataFromTelemetry() {
    if (!config.telemetryUrl || !config.vin) {
        return null;
    }
    
    try {
        // 确保 telemetryUrl 是完整的 URL（包含协议）
        let telemetryUrl = config.telemetryUrl;
        if (!telemetryUrl.startsWith('http://') && !telemetryUrl.startsWith('https://')) {
            telemetryUrl = 'https://' + telemetryUrl;
        }
        const url = `${telemetryUrl}/api/vehicle/${config.vin}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ 从 Fleet Telemetry 获取数据:', data);
            return data;
        } else if (response.status === 404) {
            // 404 表示服务器没有该车辆的数据
            const errorData = await response.json().catch(() => ({ error: 'Vehicle not found' }));
            console.warn('⚠️ Telemetry 服务器没有找到车辆数据:', errorData);
            // 返回 null，让调用者知道需要配置车辆
            return null;
        } else {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            console.warn('Telemetry 服务器响应错误:', response.status, errorData);
        }
    } catch (error) {
        console.warn('从 Telemetry 服务器获取数据失败:', error);
    }
    
    return null;
}

// 从 Fleet Telemetry 服务器获取速度（单独函数，用于快速更新）
async function fetchSpeedFromTelemetry() {
    if (!config.telemetryUrl || !config.vin) {
        return null;
    }
    
    try {
        // 确保 telemetryUrl 是完整的 URL（包含协议）
        let telemetryUrl = config.telemetryUrl;
        if (!telemetryUrl.startsWith('http://') && !telemetryUrl.startsWith('https://')) {
            telemetryUrl = 'https://' + telemetryUrl;
        }
        const url = `${telemetryUrl}/api/vehicle/${config.vin}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            // 服务器返回的 speed 已经是 km/h（服务器已转换）
            // 如果 speed 不存在，尝试使用 speedMph 并转换
            if (data.speed !== null && data.speed !== undefined) {
                return data.speed; // 已经是 km/h
            } else if (data.speedMph !== null && data.speedMph !== undefined) {
                return data.speedMph * 1.60934; // 转换为 km/h
            }
        }
    } catch (error) {
        console.warn('从 Telemetry 服务器获取速度失败:', error);
    }
    
    return null;
}

// 获取车辆数据 - 优先使用 Fleet Telemetry
async function fetchVehicleData() {
    // 防止并发请求
    if (isFetching) {
        console.log('⏸️ 已有请求在进行中，跳过本次请求');
        return;
    }
    
    // 检查请求间隔（防止请求过于频繁）
    const now = Date.now();
    if (now - lastFetchTime < MIN_FETCH_INTERVAL) {
        console.log('⏸️ 请求间隔太短，跳过本次请求');
        return;
    }
    
    isFetching = true;
    lastFetchTime = now;
    
    try {
        // 优先使用 Fleet Telemetry（如果已配置）
        if (config.telemetryUrl && config.vin) {
            updateConnectionStatus('connecting', '连接中...');
            
            // 从 Telemetry 服务器获取所有数据
            const telemetryData = await fetchVehicleDataFromTelemetry();
            
            if (telemetryData) {
                // 重置失败计数（成功获取数据）
                window.telemetryFailCount = 0;
                
                // 更新速度
                // 服务器返回的 speed 已经是 km/h（服务器已转换）
                // 如果 speed 不存在，尝试使用 speedMph 并转换
                let speed = null;
                if (telemetryData.speed !== null && telemetryData.speed !== undefined) {
                    // 服务器已经转换为 km/h，直接使用
                    speed = telemetryData.speed;
                } else if (telemetryData.speedMph !== null && telemetryData.speedMph !== undefined) {
                    // 如果只有 speedMph，转换为 km/h
                    speed = telemetryData.speedMph * 1.60934;
                }
                
                if (speed !== null) {
                    updateSpeed(speed);
                }
                
                // 更新里程
                if (telemetryData.odometer !== null && telemetryData.odometer !== undefined) {
                    const odometerElement = document.getElementById('odometer');
                    if (odometerElement) {
                        odometerElement.textContent = telemetryData.odometer.toFixed(1) + ' km';
                    }
                }
                
                // 更新电池
                if (telemetryData.batteryLevel !== null && telemetryData.batteryLevel !== undefined) {
                    const batteryElement = document.getElementById('batteryLevel');
                    if (batteryElement) {
                        batteryElement.textContent = Math.round(telemetryData.batteryLevel) + '%';
                    }
                }
                
                // 更新充电状态（如果有）
                if (telemetryData.chargingState !== null && telemetryData.chargingState !== undefined) {
                    const chargingElement = document.getElementById('chargingState');
                    if (chargingElement) {
                        const state = telemetryData.chargingState;
                        chargingElement.textContent = 
                            state === 'Charging' ? '充电中' : 
                            state === 'Disconnected' ? '未连接' : 
                            state === 'Complete' ? '已完成' : '待机';
                    }
                }
                
                updateConnectionStatus('connected', '已连接 (Telemetry)');
                updateLastUpdateTime();
                if (updateTimer) {
                    updateControlButtons(true);
                }
                return;
        } else {
            // Telemetry 获取失败（可能是 404，车辆还没有配置）
            // 如果持续失败，减少请求频率
            if (!window.telemetryFailCount) {
                window.telemetryFailCount = 0;
            }
            window.telemetryFailCount++;
            
            // 如果连续失败多次，增加请求间隔
            if (window.telemetryFailCount > 5) {
                console.log('Telemetry 服务器持续返回 404，减少请求频率...');
                // 暂时停止 Telemetry 请求，只使用 Fleet API
                if (updateTimer) {
                    // 不停止定时器，但跳过 Telemetry 请求
                }
            }
            
            // 给出友好的提示（只在第一次或每 10 次失败时显示）
            if (window.telemetryFailCount === 1 || window.telemetryFailCount % 10 === 0) {
                updateConnectionStatus('error', '⚠️ 服务器没有找到车辆数据\n\n可能原因：\n1. 车辆还没有配置发送数据到服务器\n2. 车辆还没有开始发送数据\n\n解决方案：\n1. 点击"⚙️ 配置车辆 Fleet Telemetry"来配置车辆\n2. 或等待车辆开始发送数据\n3. 如果已配置，请检查 Railway 服务器日志');
            }
            console.warn('从 Telemetry 服务器获取数据失败，尝试使用 Fleet API...');
        }
        }
        
        // 如果没有配置 Telemetry 或获取失败，使用 Fleet API（需要 API Token 和 Vehicle ID）
        if (!config.apiToken || !config.vehicleId) {
            updateConnectionStatus('error', '请配置 Fleet Telemetry 服务器 URL 和 VIN，或配置 OAuth Token 和 Vehicle ID');
            return;
        }
        
        // 检查 token 是否过期
        if (isTokenExpired()) {
            await refreshAccessToken();
            return;
        }
        
        updateConnectionStatus('connecting', '连接中...');
        
        // 构建 API URL（使用代理或直接调用）
        // Tesla Fleet API 需要 endpoints 参数来指定要返回的数据
        // 可以指定多个 endpoints，用逗号分隔
        const baseUrl = `${TESLA_API_BASE}/api/1/vehicles/${config.vehicleId}/vehicle_data`;
        // 尝试请求所有可用的 endpoints
        const urlWithParams = `${baseUrl}?endpoints=drive_state,charge_state,vehicle_state,climate_state,gui_settings,vehicle_config`;
        const apiUrl = config.proxyUrl 
            ? `${config.proxyUrl}?url=${encodeURIComponent(urlWithParams)}`
            : urlWithParams;
        
        console.log('请求 vehicle_data URL:', apiUrl);
        
        // 准备单独获取 drive_state 的 URL（作为备用）
        const driveStateUrl = `${TESLA_API_BASE}/api/1/vehicles/${config.vehicleId}/drive_state`;
        const driveStateApiUrl = config.proxyUrl 
            ? `${config.proxyUrl}?url=${encodeURIComponent(driveStateUrl)}`
            : driveStateUrl;
        
        let response;
        try {
            const fetchOptions = {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${config.apiToken}`,
                    'Content-Type': 'application/json'
                }
            };
            
            // 如果使用代理，可能需要不同的请求格式
            if (config.proxyUrl) {
                // 代理服务器应该转发 Authorization 头
                response = await fetch(apiUrl, fetchOptions);
            } else {
                // 直接调用（可能被 CORS 阻止）
                response = await fetch(apiUrl, fetchOptions);
            }
        } catch (fetchError) {
            console.error('获取车辆数据的 Fetch 错误:', fetchError);
            throw new Error(`网络请求失败: ${fetchError.message}`);
        }
        
        if (response.status === 401) {
            // Token 过期，尝试刷新（只有在定时器仍在运行时）
            if (updateTimer) {
                await refreshAccessToken();
            } else {
                console.log('定时器已停止，取消 token 刷新');
            }
            return;
        }
        
        if (!response.ok) {
            const errorData = await response.text().catch(() => response.statusText);
            let errorJson;
            try {
                errorJson = JSON.parse(errorData);
            } catch (e) {
                errorJson = { error: errorData };
            }
            
            // 如果是 412 错误（需要注册），尝试自动注册
            if (response.status === 412 && errorJson.error && errorJson.error.includes('must be registered')) {
                console.log('检测到 412 错误，尝试自动注册账户...');
                updateConnectionStatus('connecting', '检测到需要注册账户，正在自动注册...');
                
                try {
                    await registerPartnerAccount();
                    updateConnectionStatus('connected', '账户注册成功！正在重新获取数据...');
                    
                    // 重新尝试获取车辆数据（只有在定时器仍在运行时）
                    if (updateTimer) {
                        return await fetchVehicleData();
                    } else {
                        console.log('定时器已停止，取消重新获取数据');
                        return;
                    }
                } catch (regError) {
                    console.error('自动注册失败:', regError);
                    throw new Error(`账户需要注册到区域。自动注册失败: ${regError.message}`);
                }
            }
            
            throw new Error(`API 错误: ${response.status} - ${errorData}`);
        }
        
        const data = await response.json();
        
        // 调试：输出完整的响应数据
        console.log('Tesla API 完整响应:', JSON.stringify(data, null, 2));
        
        // 检查是否返回了车辆列表而不是 vehicle_data
        if (Array.isArray(data.response)) {
            console.error('❌ API 返回了车辆列表而不是 vehicle_data！');
            console.error('当前 Vehicle ID:', config.vehicleId);
            console.error('响应数据:', data);
            
            updateConnectionStatus('error', `API 返回了车辆列表。请检查 Vehicle ID 是否正确（当前: ${config.vehicleId}）`);
            
            // 建议使用 Telemetry
            if (!config.telemetryUrl || !config.vin) {
                updateConnectionStatus('error', `API 返回了车辆列表。建议：\n1. 检查 Vehicle ID\n2. 配置 Fleet Telemetry 服务器 URL 和 VIN`);
            }
            
            return;
        }
        
        // 检查是否返回了车辆基本信息对象（而不是 vehicle_data）
        if (data.response && (data.response.id || data.response.vin) && !data.response.charge_state && !data.response.vehicle_state) {
            console.warn('⚠️ API 返回了车辆基本信息对象而不是 vehicle_data');
            console.log('当前 Vehicle ID:', config.vehicleId);
            console.log('响应对象键:', Object.keys(data.response));
            
            // 如果返回了 vehicle_id，尝试使用它
            if (data.response.vehicle_id && data.response.vehicle_id !== config.vehicleId) {
                console.log('检测到 vehicle_id，更新配置:', data.response.vehicle_id);
                config.vehicleId = data.response.vehicle_id;
                localStorage.setItem('teslaDashConfig', JSON.stringify(config));
                // 重新尝试获取数据
                return await fetchVehicleData();
            }
            
            // 如果返回了 VIN，自动填充
            if (data.response.vin && !config.vin) {
                config.vin = data.response.vin;
                const vinInput = document.getElementById('vin');
                if (vinInput) {
                    vinInput.value = config.vin;
                    console.log('✅ 自动填充 VIN:', config.vin);
                }
                localStorage.setItem('teslaDashConfig', JSON.stringify(config));
            }
            
            // 如果配置了 Telemetry，提示使用 Telemetry
            if (config.telemetryUrl && config.vin) {
                updateConnectionStatus('error', 'API 返回了车辆信息而不是车辆数据。\n\n建议：使用 Fleet Telemetry 服务器获取实时数据（已配置）');
            } else {
                updateConnectionStatus('error', 'API 返回了车辆信息而不是车辆数据。\n\n建议：\n1. 配置 Fleet Telemetry 服务器 URL 和 VIN\n2. 或检查 Vehicle ID 是否正确');
            }
            
            return;
        }
        
        if (data.response) {
            // 调试：输出 response 对象的结构
            console.log('Response 对象:', data.response);
            console.log('Response 对象的键:', Object.keys(data.response));
            
            // 检查 drive_state
            if (data.response.drive_state) {
                console.log('✅ drive_state 存在:', data.response.drive_state);
                console.log('drive_state 的键:', Object.keys(data.response.drive_state));
            } else {
                console.warn('❌ drive_state 不存在！尝试单独获取 drive_state...');
                
                // 如果 vehicle_data 没有返回 drive_state，尝试单独获取
                try {
                    const driveStateResponse = await fetch(driveStateApiUrl, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${config.apiToken}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (driveStateResponse.ok) {
                        const driveStateData = await driveStateResponse.json();
                        console.log('单独获取的 drive_state 响应:', driveStateData);
                        if (driveStateData.response) {
                            // 将 drive_state 添加到 response 中
                            data.response.drive_state = driveStateData.response;
                            console.log('✅ 成功获取 drive_state:', driveStateData.response);
                            console.log('drive_state 的键:', Object.keys(driveStateData.response));
                        }
                    } else {
                        const errorText = await driveStateResponse.text().catch(() => '');
                        console.warn('单独获取 drive_state 失败:', driveStateResponse.status, errorText);
                    }
                } catch (driveStateError) {
                    console.warn('单独获取 drive_state 出错:', driveStateError);
                }
            }
            
            // 检查 vehicle_state
            if (data.response.vehicle_state) {
                console.log('vehicle_state:', data.response.vehicle_state);
                console.log('vehicle_state 的键:', Object.keys(data.response.vehicle_state));
            }
            
            updateDashboard(data.response);
            updateConnectionStatus('connected', '已连接');
            updateLastUpdateTime();
            // 确保按钮在连接成功时显示
            if (updateTimer) {
                updateControlButtons(true);
            }
        } else {
            throw new Error('无效的响应数据');
        }
        
    } catch (error) {
        console.error('获取车辆数据失败:', error);
        updateConnectionStatus('error', `错误: ${error.message}`);
    } finally {
        // 释放请求锁
        isFetching = false;
    }
}

// 获取其他车辆数据（电池、里程等，不包含速度）
async function fetchOtherVehicleData() {
    try {
        if (isTokenExpired()) {
            await refreshAccessToken();
            return;
        }
        
        const baseUrl = `${TESLA_API_BASE}/api/1/vehicles/${config.vehicleId}/vehicle_data`;
        const urlWithParams = `${baseUrl}?endpoints=charge_state,vehicle_state`;
        const apiUrl = config.proxyUrl 
            ? `${config.proxyUrl}?url=${encodeURIComponent(urlWithParams)}`
            : urlWithParams;
        
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${config.apiToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.response) {
                // 只更新电池和里程，不更新速度
                const chargeState = data.response.charge_state;
                if (chargeState) {
                    const batteryLevel = chargeState.battery_level || chargeState.charging_state;
                    if (batteryLevel !== undefined) {
                        document.getElementById('batteryValue').textContent = Math.round(batteryLevel);
                    }
                }
                
                const vehicleState = data.response.vehicle_state;
                if (vehicleState) {
                    const odometer = vehicleState.odometer;
                    if (odometer !== undefined) {
                        document.getElementById('odometerValue').textContent = odometer.toFixed(1) + ' km';
                    }
                }
            }
        }
    } catch (error) {
        console.warn('获取其他车辆数据失败:', error);
    }
}

// 更新仪表盘
function updateDashboard(vehicleData) {
    // 更新速度 - 尝试多个可能的字段名
    let speed = 0;
    
    console.log('updateDashboard - 开始处理速度数据');
    console.log('vehicleData 完整对象:', vehicleData);
    
    // 根据 Tesla 官方文档：
    // - Fleet Telemetry 使用 VehicleSpeed（单位：mph）
    // - Fleet API 的 drive_state 可能使用 speed（单位可能是 mph 或 km/h，取决于车辆设置）
    // 优先尝试 VehicleSpeed 字段（Fleet Telemetry），然后尝试 speed 字段（Fleet API）
    let speedInMph = null;
    let speedFound = false;
    
    // 方法1: 查找 VehicleSpeed（Fleet Telemetry 格式，明确是 mph）
    if (vehicleData.drive_state?.VehicleSpeed !== undefined && vehicleData.drive_state?.VehicleSpeed !== null) {
        speedInMph = vehicleData.drive_state.VehicleSpeed;
        speedFound = true;
        console.log('✅ 找到速度: drive_state.VehicleSpeed =', speedInMph, 'mph (Fleet Telemetry)');
    } else if (vehicleData.VehicleSpeed !== undefined && vehicleData.VehicleSpeed !== null) {
        speedInMph = vehicleData.VehicleSpeed;
        speedFound = true;
        console.log('✅ 找到速度: VehicleSpeed =', speedInMph, 'mph (Fleet Telemetry)');
    } else if (vehicleData.vehicle_state?.VehicleSpeed !== undefined && vehicleData.vehicle_state?.VehicleSpeed !== null) {
        speedInMph = vehicleData.vehicle_state.VehicleSpeed;
        speedFound = true;
        console.log('✅ 找到速度: vehicle_state.VehicleSpeed =', speedInMph, 'mph (Fleet Telemetry)');
    }
    
    // 方法2: 查找 speed 字段（Fleet API 格式，单位取决于车辆设置）
    if (!speedFound && vehicleData.drive_state?.speed !== undefined && vehicleData.drive_state?.speed !== null) {
        const rawSpeed = vehicleData.drive_state.speed;
        console.log('找到速度: drive_state.speed =', rawSpeed, '(Fleet API)');
        
        // Fleet API 的 speed 字段单位取决于车辆的设置（可能是 mph 或 km/h）
        // 如果值看起来像 mph（通常 < 150），假设是 mph 并转换
        // 如果值看起来像 km/h（通常 >= 150），假设已经是 km/h
        if (rawSpeed < 150 && rawSpeed > 0) {
            console.log('速度值较小，假设是 mph，转换为 km/h');
            speed = rawSpeed * 1.60934;
        } else {
            console.log('速度值较大，假设已经是 km/h');
            speed = rawSpeed;
        }
        speedFound = true;
    } else if (!speedFound && vehicleData.vehicle_state?.speed !== undefined && vehicleData.vehicle_state?.speed !== null) {
        const rawSpeed = vehicleData.vehicle_state.speed;
        console.log('找到速度: vehicle_state.speed =', rawSpeed);
        if (rawSpeed < 150 && rawSpeed > 0) {
            console.log('速度值较小，假设是 mph，转换为 km/h');
            speed = rawSpeed * 1.60934;
        } else {
            speed = rawSpeed;
        }
        speedFound = true;
    } else if (!speedFound && vehicleData.speed !== undefined && vehicleData.speed !== null) {
        const rawSpeed = vehicleData.speed;
        console.log('找到速度: speed =', rawSpeed);
        if (rawSpeed < 150 && rawSpeed > 0) {
            console.log('速度值较小，假设是 mph，转换为 km/h');
            speed = rawSpeed * 1.60934;
        } else {
            speed = rawSpeed;
        }
        speedFound = true;
    }
    
    if (!speedFound) {
        // 详细调试：列出所有可能的字段
        console.warn('未找到速度数据！');
        console.log('尝试的字段值:', {
            'VehicleSpeed': vehicleData.VehicleSpeed,
            'vehicle_state.VehicleSpeed': vehicleData.vehicle_state?.VehicleSpeed,
            'drive_state.VehicleSpeed': vehicleData.drive_state?.VehicleSpeed,
            'drive_state.speed': vehicleData.drive_state?.speed,
            'vehicle_state.speed': vehicleData.vehicle_state?.speed,
            'speed': vehicleData.speed
        });
        
        // 列出所有顶层键
        console.log('vehicleData 的所有顶层键:', Object.keys(vehicleData));
        
        // 如果 drive_state 存在，列出它的所有键
        if (vehicleData.drive_state) {
            console.log('drive_state 的所有键:', Object.keys(vehicleData.drive_state));
            console.log('drive_state 完整内容:', vehicleData.drive_state);
        }
        
        // 如果 vehicle_state 存在，列出它的所有键
        if (vehicleData.vehicle_state) {
            console.log('vehicle_state 的所有键:', Object.keys(vehicleData.vehicle_state));
        }
    }
    
    // 如果找到了 VehicleSpeed（mph），转换为 km/h
    if (speedInMph !== null) {
        speed = speedInMph * 1.60934; // 英里/小时 转 公里/小时
        console.log('VehicleSpeed 转换: ', speedInMph, 'mph =', speed, 'km/h');
    }
    
    // 确保速度值有效
    if (speed === undefined || speed === null || isNaN(speed)) {
        speed = 0;
        console.warn('⚠️ 速度值无效，设置为 0');
    }
    
    console.log('最终使用的速度值:', speed, 'km/h');
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
    
    // 根据速度改变颜色
    let color = '#00ff00'; // 绿色
    if (speedValue > 120) {
        color = '#ff0000'; // 红色
    } else if (speedValue > 80) {
        color = '#ffaa00'; // 橙色
    }
    
    document.getElementById('speedValue').style.color = color;
    document.getElementById('speedValue').style.textShadow = 
        `0 0 10px ${color}80, 0 0 20px ${color}60, 0 0 30px ${color}40, 0 0 40px ${color}20`;
}


// 更新连接状态
function updateConnectionStatus(status, message) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    statusDot.className = 'status-dot';
    
    // 根据状态更新按钮显示
    if (status === 'connected' && updateTimer) {
        updateControlButtons(true);
    } else if (status === 'paused') {
        updateControlButtons(false);
    } else if (status === 'connected' && !updateTimer) {
        // 如果显示已连接但没有定时器，显示开始按钮
        updateControlButtons(false);
    }
    
    if (status === 'connected') {
        statusDot.classList.add('connected');
        statusText.textContent = '已连接';
    } else if (status === 'error') {
        statusDot.classList.add('error');
        statusText.textContent = message;
        updateControlButtons(false);
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
            updateControlButtons(false);
        }
    } else {
        // 页面可见时，只有在之前有定时器运行的情况下才自动恢复
        // 如果用户手动停止了，不会自动恢复
        if (!updateTimer && config.apiToken && config.vehicleId) {
            // 不自动恢复，让用户手动控制
            // startUpdates();
        }
    }
});

