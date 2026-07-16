#!/usr/bin/env bash

# =============================================================================
# NextChat 数据库连接修复脚本
# =============================================================================
# 用途：修复宝塔 PostgreSQL 的 pg_hba.conf，确保容器可以正常连接数据库
# 适用于：docker-compose.baota.yml 使用 host 网络模式的部署
#
# 工作原理：
# 1. 检测 PostgreSQL 数据目录位置（支持宝塔默认路径）
# 2. 获取容器使用的网络 IP 段
# 3. 在 pg_hba.conf 中添加必要的网段规则
# 4. 重载 PostgreSQL 配置
#
# 使用方式（在部署后执行）：
#   ./scripts/fix-pg-hba.sh
#
# 或者在部署脚本中自动调用：
#   source ./scripts/fix-pg-hba.sh && fix_pg_hba_conf
# =============================================================================

set -euo pipefail

# PostgreSQL 常见数据目录
PG_DATA_DIRS=(
    "/www/server/pgsql/data"
    "/var/lib/pgsql/data"
    "/var/lib/postgresql/data"
    "/etc/postgresql/*/main"
)

# 宝塔默认数据库配置
BAOTA_PG_USER="${BAOTA_PG_USER:-dyx}"
BAOTA_PG_DATABASES="${BAOTA_PG_DATABASES:-nextchat,nextchat_backup}"

# 容器网络检测配置
CONTAINER_NAME="${CONTAINER_NAME:-nextchat}"

# -----------------------------------------------------------------------------
# 检测 PostgreSQL 数据目录
# -----------------------------------------------------------------------------
detect_pg_data_dir() {
    for dir in "${PG_DATA_DIRS[@]}"; do
        # 支持通配符
        if [[ "$dir" == *"*"* ]]; then
            local matches
            matches=$(eval "ls -d $dir 2>/dev/null" | head -1 || true)
            if [[ -n "$matches" && -d "$matches" ]]; then
                echo "$matches"
                return 0
            fi
        elif [[ -d "$dir" && -f "$dir/pg_hba.conf" ]]; then
            echo "$dir"
            return 0
        fi
    done
    return 1
}

# -----------------------------------------------------------------------------
# 检测容器使用的网络 IP
# -----------------------------------------------------------------------------
detect_container_network() {
    local container_name="$1"

    # 获取容器的主网络信息
    local ip_info
    ip_info=$(docker inspect "$container_name" --format '{{range $net, $conf := .NetworkSettings.Networks}}{{$net}}:{{$conf.IPAddress}}:{{end}}' 2>/dev/null) || true

    # 提取第一个非空 IP
    local ip
    ip=$(echo "$ip_info" | tr ':' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1) || true

    if [[ -n "$ip" ]]; then
        echo "$ip"
        return 0
    fi

    # host 网络模式：使用主机 IP（通常是第一个非回环 IP）
    local host_ip
    host_ip=$(hostname -I 2>/dev/null | awk '{print $1}') || true
    if [[ -n "$host_ip" ]]; then
        echo "$host_ip"
        return 0
    fi

    # 备用：使用 PGHOST 环境变量（如果有）
    if [[ -n "${PGHOST:-}" ]]; then
        echo "${PGHOST}"
        return 0
    fi

    return 1
}

# -----------------------------------------------------------------------------
# 计算网段
# -----------------------------------------------------------------------------
ip_to_cidr() {
    local ip="$1"
    local cidr="24"  # 默认 /24

    # 如果 IP 在 Docker bridge 网段，使用 /16 以覆盖所有 Docker 网络
    if [[ "$ip" == 172.* ]]; then
        cidr="16"
    fi

    # 提取前三段作为网络地址
    echo "$ip" | awk -F. '{print $1"."$2"."$3".0/'$cidr'"}'
}

# -----------------------------------------------------------------------------
# 检查 pg_hba.conf 是否已包含指定网段
# -----------------------------------------------------------------------------
pg_hba_has_network() {
    local pg_hba_conf="$1"
    local network="$2"

    grep -qE "^host[[:space:]]+(${BAOTA_PG_DATABASES//,/(|})[[:space:]]+${BAOTA_PG_USER}[[:space:]]+${network}[[:space:]]" "$pg_hba_conf" 2>/dev/null
}

# -----------------------------------------------------------------------------
# 添加 pg_hba.conf 规则
# -----------------------------------------------------------------------------
add_pg_hba_rules() {
    local pg_hba_conf="$1"
    local network="$2"
    local pg_data_dir
    pg_data_dir=$(dirname "$pg_hba_conf")

    echo "[pg-hba-fix] 添加网段规则: $network"

    for db in $(echo "$BAOTA_PG_DATABASES" | tr ',' ' '); do
        if ! pg_hba_has_network "$pg_hba_conf" "$network"; then
            echo "host    ${db}    ${BAOTA_PG_USER}    ${network}    md5" >> "$pg_hba_conf"
            echo "[pg-hba-fix] 已添加: host ${db} ${BAOTA_PG_USER} ${network} md5"
        else
            echo "[pg-hba-fix] 规则已存在: host ${db} ${BAOTA_PG_USER} ${network} md5"
        fi
    done
}

# -----------------------------------------------------------------------------
# 重载 PostgreSQL 配置
# -----------------------------------------------------------------------------
reload_postgresql() {
    local pg_data_dir="$1"

    echo "[pg-hba-fix] 尝试重载 PostgreSQL 配置..."

    # 方法1: 使用 pg_ctl (postgres 用户)
    if [[ -x "$pg_data_dir/../bin/pg_ctl" ]]; then
        su - postgres -c "$pg_data_dir/../bin/pg_ctl reload -D $pg_data_dir" 2>/dev/null && {
            echo "[pg-hba-fix] PostgreSQL 配置已重载 (pg_ctl)"
            return 0
        }
    fi

    # 方法2: 使用 pg_ctl (完整路径)
    if command -v pg_ctl >/dev/null 2>&1; then
        su - postgres -c "pg_ctl reload -D $pg_data_dir" 2>/dev/null && {
            echo "[pg-hba-fix] PostgreSQL 配置已重载 (pg_ctl)"
            return 0
        }
    fi

    # 方法3: 发送 HUP 信号给 postmaster
    local pid_file="$pg_data_dir/postmaster.pid"
    if [[ -f "$pid_file" ]]; then
        local pid
        pid=$(cat "$pid_file" 2>/dev/null | head -1)
        if [[ -n "$pid" ]] && kill -HUP "$pid" 2>/dev/null; then
            echo "[pg-hba-fix] PostgreSQL 配置已重载 (HUP signal)"
            return 0
        fi
    fi

    # 方法4: systemctl
    for svc in postgresql postgresql-*.service; do
        if systemctl is-active --quiet "$svc" 2>/dev/null; then
            systemctl reload "$svc" 2>/dev/null && {
                echo "[pg-hba-fix] PostgreSQL 配置已重载 (systemctl reload $svc)"
                return 0
            }
        fi
    done

    echo "[pg-hba-fix] 警告: 无法自动重载 PostgreSQL，请手动执行: systemctl reload postgresql"
    return 1
}

# -----------------------------------------------------------------------------
# 主函数：修复 pg_hba.conf
# -----------------------------------------------------------------------------
fix_pg_hba_conf() {
    echo "[pg-hba-fix] 开始修复 PostgreSQL pg_hba.conf..."

    # 1. 检测 PostgreSQL 数据目录
    local pg_data_dir
    pg_data_dir=$(detect_pg_data_dir) || {
        echo "[pg-hba-fix] 错误: 无法找到 PostgreSQL 数据目录"
        return 1
    }
    echo "[pg-hba-fix] PostgreSQL 数据目录: $pg_data_dir"

    local pg_hba_conf="$pg_data_dir/pg_hba.conf"
    if [[ ! -f "$pg_hba_conf" ]]; then
        echo "[pg-hba-fix] 错误: pg_hba.conf 不存在: $pg_hba_conf"
        return 1
    fi

    # 2. 检测容器网络
    local container_ip
    container_ip=$(detect_container_network "$CONTAINER_NAME") || {
        echo "[pg-hba-fix] 警告: 无法检测容器网络，使用 PGHOST 环境变量"
        container_ip="${PGHOST:-10.0.0.1}"
    }
    echo "[pg-hba-fix] 容器网络 IP: $container_ip"

    # 3. 计算需要的网段
    local network
    network=$(ip_to_cidr "$container_ip")
    echo "[pg-hba-fix] 需要添加的网段: $network"

    # 4. 检查是否已存在
    if pg_hba_has_network "$pg_hba_conf" "$network"; then
        echo "[pg-hba-fix] 网段 $network 规则已存在，无需修改"
        return 0
    fi

    # 5. 备份原配置
    local backup_file="${pg_hba_conf}.backup.$(date +%Y%m%d%H%M%S)"
    cp -a "$pg_hba_conf" "$backup_file"
    echo "[pg-hba-fix] 已备份: $backup_file"

    # 6. 添加规则
    add_pg_hba_rules "$pg_hba_conf" "$network"

    # 7. 重载配置
    reload_postgresql "$pg_data_dir"

    echo "[pg-hba-fix] 完成!"
    return 0
}

# -----------------------------------------------------------------------------
# 入口
# -----------------------------------------------------------------------------
# 如果直接执行此脚本，则运行主函数
# 如果被 source，则只定义函数
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    fix_pg_hba_conf
fi
