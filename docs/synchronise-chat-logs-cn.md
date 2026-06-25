# 同步聊天记录

> ⚠️ **已过时**：本教程介绍的是 Upstash Redis 同步方式。**当前项目已移除 Upstash / WebDAV 同步**，云端同步统一改为 PostgreSQL 数据库（`app/utils/cloud/index.ts` 的 `ProviderType` 仅保留 `Database`）。请改阅：
> - [同步功能使用指南](sync-usage-guide.md)
> - [数据存储同步总表](db/data-storage-sync-matrix.md)
> - [本地优先同步规则](db/local-first-sync-rules.md)

## 准备工作
- GitHub账号
- 拥有自己搭建过的ChatGPT-Next-Web的服务器
- [UpStash](https://upstash.com)

## 开始教程
1. 注册UpStash账号
2. 创建数据库

    ![注册登录](./images/upstash-1.png)

    ![创建数据库](./images/upstash-2.png)

    ![选择服务器](./images/upstash-3.png)

3. 找到REST API，分别复制UPSTASH_REDIS_REST_URL和UPSTASH_REDIS_REST_TOKEN（⚠切记⚠：不要泄露Token!）

   ![复制](./images/upstash-4.png)

4. UPSTASH_REDIS_REST_URL和UPSTASH_REDIS_REST_TOKEN复制到你的同步配置，点击**检查可用性**

    ![同步1](./images/upstash-5.png)

    如果没什么问题，那就成功了

    ![同步可用性完成的样子](./images/upstash-6.png)

5. Success! 

   ![好耶~！](./images/upstash-7.png)
