#!/bin/sh

set -eu

BUILDX_CONFIG_DIR="${BUILDX_CONFIG:-/tmp/nextchat-docker-buildx}"
mkdir -p "$BUILDX_CONFIG_DIR"

export BUILDX_CONFIG="$BUILDX_CONFIG_DIR"

# 构建时始终使用当前仓库提交，避免服务器残留环境变量覆盖实际部署版本。
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	BUILD_COMMIT_HASH="$(git rev-parse HEAD)"
	BUILD_COMMIT_DATE="$(git log -1 --format='%at000')"
	export BUILD_COMMIT_HASH BUILD_COMMIT_DATE
fi

# 本地镜像构建统一经全局测速脚本选出的最快镜像源（~/ai_coding_rules/coding-deploy.md 第 3 节）。
# 仅拦截含 build 子命令的调用；up/down/logs/ps 等直接透传原生 docker compose。
# 实现方式：把本次调用的 -f / --env-file / -p / --profile 转成 COMPOSE_FILE、COMPOSE_ENV_FILES、
# COMPOSE_PROJECT_NAME、COMPOSE_PROFILES 环境变量，再调用包装脚本的 --compose-build，
# 因为包装脚本内部固定执行 `docker compose build --builder <胜出 builder>`，不接受全局参数。
BUILD_FASTEST="${DOCKER_FASTEST_WRAPPER:-$HOME/ai_coding_rules/scripts/docker-build-fastest.sh}"

has_build=0
for arg in "$@"; do
	if [ "$arg" = "build" ]; then
		has_build=1
		break
	fi
done

# 在函数内解析：函数有独立的位置参数，遇到无法表达的参数时 return 1，
# 外层仍持有完整原始参数，可原样降级为原生 docker compose，不会丢失已解析的 -f/--env-file。
run_fastest_build() {
	compose_files=""
	env_files=""
	profiles=""
	project_name=""
	build_args=""
	while [ "$#" -gt 0 ]; do
		case "$1" in
		-f | --file | --env-file | -p | --project-name | --profile)
			if [ "$#" -lt 2 ]; then
				return 1
			fi
			case "$1" in
			-f | --file) compose_files="${compose_files:+$compose_files:}$2" ;;
			--env-file) env_files="${env_files:+$env_files,}$2" ;;
			-p | --project-name) project_name="$2" ;;
			--profile) profiles="${profiles:+$profiles,}$2" ;;
			esac
			shift 2
			;;
		build)
			shift
			# build 之后的参数（--no-cache、服务名等）原样转交包装脚本的 -- 之后。
			while [ "$#" -gt 0 ]; do
				build_args="${build_args:+$build_args }$(printf '%s' "$1" | sed "s/'/'\\\\''/g; s/^/'/; s/\$/'/")"
				shift
			done
			;;
		*)
			# build 之前的其他 compose 全局参数（含 --env-file=xxx 等写法）无法经环境变量表达，降级为原生构建。
			echo "[docker-compose-safe] 检测到未识别的 compose 全局参数 '$1'，本次跳过测速直接原生构建。" >&2
			return 1
			;;
		esac
	done

	if [ -n "$compose_files" ]; then
		COMPOSE_FILE="$compose_files"
		export COMPOSE_FILE
	fi
	if [ -n "$env_files" ]; then
		COMPOSE_ENV_FILES="$env_files"
		export COMPOSE_ENV_FILES
	fi
	if [ -n "$profiles" ]; then
		COMPOSE_PROFILES="$profiles"
		export COMPOSE_PROFILES
	fi
	if [ -n "$project_name" ]; then
		COMPOSE_PROJECT_NAME="$project_name"
		export COMPOSE_PROJECT_NAME
	fi

	if [ -n "$build_args" ]; then
		eval "set -- $build_args"
		exec "$BUILD_FASTEST" --compose-build -- "$@"
	fi
	exec "$BUILD_FASTEST" --compose-build --
}

# 注意：`up --build` 不含独立的 build 子命令，仍走原生 docker compose 构建。
if [ "$has_build" -eq 1 ] && [ -x "$BUILD_FASTEST" ] && [ "${NEXTCHAT_SKIP_MIRROR_BENCHMARK:-0}" != "1" ]; then
	run_fastest_build "$@" || true
fi

exec docker compose "$@"
