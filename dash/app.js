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
    updateInterval: 2,
    proxyUrl: '' // CORS 代理 URL（可选）
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
    
    // 检查 URL 中是否有 OAuth 回调参数（延迟执行，确保 DOM 已加载）
    setTimeout(() => {
        handleOAuthCallback();
    }, 100);
    
    // 如果有 token，开始更新（但不在 OAuth 回调时）
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.get('code') && !urlParams.get('error')) {
        if (config.apiToken && config.vehicleId) {
            // 检查 token 是否过期
            if (isTokenExpired()) {
                refreshAccessToken();
            } else {
                startUpdates();
            }
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
        const proxyInput = document.getElementById('proxyUrl');
        if (proxyInput) {
            proxyInput.value = config.proxyUrl || '';
        }
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
    const proxyInput = document.getElementById('proxyUrl');
    if (proxyInput) {
        config.proxyUrl = proxyInput.value.trim();
    }
    
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
    
    // 更新按钮状态
    updateControlButtons(true);
}

// 停止更新
function stopUpdates() {
    if (updateTimer) {
        clearInterval(updateTimer);
        updateTimer = null;
    }
    
    // 更新按钮状态
    updateControlButtons(false);
    updateConnectionStatus('paused', '已暂停读取');
}

// 切换更新状态
function toggleUpdates() {
    if (updateTimer) {
        stopUpdates();
    } else {
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
async function refreshAccessToken() {
    if (!config.refreshToken || !config.clientId || !config.clientSecret) {
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
        
        // 获取并验证 Client Secret
        const clientSecret = document.getElementById('clientSecret').value.trim();
        if (!clientSecret) {
            alert('请先填写 Client Secret！\n\n这是必需的，用于 OAuth 认证。');
            updateOAuthStatus('error', '请先填写 Client Secret');
            document.getElementById('clientSecret').focus();
            return;
        }
        
        // 保存配置（包括 clientSecret）
        config.clientId = clientId;
        config.clientSecret = clientSecret;
        config.redirectUri = redirectUri;
        localStorage.setItem('teslaDashConfig', JSON.stringify(config));
        
        console.log('已保存配置 - Client ID:', clientId.substring(0, 10) + '...');
        console.log('已保存配置 - Client Secret:', clientSecret ? '已设置（长度: ' + clientSecret.length + '）' : '未设置');
        
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
            const secretInput = document.getElementById('clientSecret');
            if (secretInput) {
                secretInput.focus();
                // 高亮显示输入框
                secretInput.style.borderColor = '#ff0000';
                secretInput.style.boxShadow = '0 0 10px rgba(255, 0, 0, 0.5)';
                setTimeout(() => {
                    secretInput.style.borderColor = '';
                    secretInput.style.boxShadow = '';
                }, 3000);
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
        
        // 构建 API URL（使用代理或直接调用）
        const apiUrl = config.proxyUrl 
            ? `${config.proxyUrl}?url=${encodeURIComponent(`${TESLA_API_BASE}/api/1/vehicles/${config.vehicleId}/vehicle_data`)}`
            : `${TESLA_API_BASE}/api/1/vehicles/${config.vehicleId}/vehicle_data`;
        
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
            // Token 过期，尝试刷新
            await refreshAccessToken();
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
                    
                    // 重新尝试获取车辆数据
                    return await fetchVehicleData();
                } catch (regError) {
                    console.error('自动注册失败:', regError);
                    throw new Error(`账户需要注册到区域。自动注册失败: ${regError.message}`);
                }
            }
            
            throw new Error(`API 错误: ${response.status} - ${errorData}`);
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

