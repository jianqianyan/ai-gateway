-- CreateTable
CREATE TABLE `AdminUser` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(64) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `displayName` VARCHAR(100) NULL,
    `role` ENUM('ADMIN', 'VIEWER') NOT NULL DEFAULT 'VIEWER',
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdminUser_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `ip` VARCHAR(64) NULL,
    `userAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `RefreshToken_userId_idx`(`userId`),
    INDEX `RefreshToken_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Provider` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `type` ENUM('OPENAI', 'ANTHROPIC', 'GEMINI', 'AZURE_OPENAI') NOT NULL,
    `baseUrl` VARCHAR(500) NOT NULL,
    `apiKeyCipher` TEXT NULL,
    `apiKeyIv` VARCHAR(100) NULL,
    `apiKeyTag` VARCHAR(100) NULL,
    `keyVersion` INTEGER NOT NULL DEFAULT 1,
    `headers` JSON NULL,
    `timeoutMs` INTEGER NOT NULL DEFAULT 120000,
    `maxRetries` INTEGER NOT NULL DEFAULT 1,
    `priority` INTEGER NOT NULL DEFAULT 10,
    `weight` INTEGER NOT NULL DEFAULT 100,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `health` ENUM('UNKNOWN', 'HEALTHY', 'DEGRADED', 'DOWN') NOT NULL DEFAULT 'UNKNOWN',
    `lastCheckedAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Provider_enabled_priority_idx`(`enabled`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderModel` (
    `id` VARCHAR(191) NOT NULL,
    `providerId` VARCHAR(191) NOT NULL,
    `upstreamModel` VARCHAR(200) NOT NULL,
    `displayName` VARCHAR(200) NULL,
    `capabilities` JSON NULL,
    `contextWindow` INTEGER NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `discoveredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProviderModel_providerId_idx`(`providerId`),
    UNIQUE INDEX `ProviderModel_providerId_upstreamModel_key`(`providerId`, `upstreamModel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Model` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `displayName` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `capabilities` JSON NULL,
    `contextWindow` INTEGER NULL,
    `inputPrice` DECIMAL(12, 6) NULL,
    `outputPrice` DECIMAL(12, 6) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Model_name_key`(`name`),
    INDEX `Model_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModelRoute` (
    `id` VARCHAR(191) NOT NULL,
    `modelId` VARCHAR(191) NOT NULL,
    `providerModelId` VARCHAR(191) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 10,
    `weight` INTEGER NOT NULL DEFAULT 100,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ModelRoute_modelId_priority_idx`(`modelId`, `priority`),
    UNIQUE INDEX `ModelRoute_modelId_providerModelId_key`(`modelId`, `providerModelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiKey` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `keyPrefix` VARCHAR(24) NOT NULL,
    `keyHash` VARCHAR(64) NOT NULL,
    `last4` VARCHAR(8) NOT NULL,
    `owner` VARCHAR(100) NULL,
    `note` TEXT NULL,
    `status` ENUM('ACTIVE', 'DISABLED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `expiresAt` DATETIME(3) NULL,
    `quotaRequests` BIGINT NULL,
    `quotaTokens` BIGINT NULL,
    `quotaCost` DECIMAL(14, 6) NULL,
    `usedRequests` BIGINT NOT NULL DEFAULT 0,
    `usedTokens` BIGINT NOT NULL DEFAULT 0,
    `usedCost` DECIMAL(14, 6) NOT NULL DEFAULT 0,
    `rpmLimit` INTEGER NULL,
    `tpmLimit` INTEGER NULL,
    `concurrencyLimit` INTEGER NULL,
    `dailyRequestLimit` INTEGER NULL,
    `monthlyTokenLimit` BIGINT NULL,
    `monthlyCostLimit` DECIMAL(14, 6) NULL,
    `ipAllowlist` JSON NULL,
    `sensitivePolicyId` VARCHAR(191) NULL,
    `logBody` BOOLEAN NOT NULL DEFAULT false,
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ApiKey_keyHash_key`(`keyHash`),
    INDEX `ApiKey_status_idx`(`status`),
    INDEX `ApiKey_sensitivePolicyId_idx`(`sensitivePolicyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiKeyModel` (
    `apiKeyId` VARCHAR(191) NOT NULL,
    `modelId` VARCHAR(191) NOT NULL,

    INDEX `ApiKeyModel_modelId_idx`(`modelId`),
    PRIMARY KEY (`apiKeyId`, `modelId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SensitivePolicy` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SensitivePolicy_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SensitiveRule` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `category` VARCHAR(50) NOT NULL,
    `type` ENUM('KEYWORD', 'REGEX', 'BUILTIN') NOT NULL,
    `pattern` TEXT NULL,
    `action` ENUM('BLOCK', 'MASK', 'LOG') NOT NULL DEFAULT 'BLOCK',
    `direction` ENUM('INPUT', 'OUTPUT', 'BOTH') NOT NULL DEFAULT 'BOTH',
    `severity` INTEGER NOT NULL DEFAULT 50,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `priority` INTEGER NOT NULL DEFAULT 10,
    `replacement` VARCHAR(50) NULL,
    `isBuiltin` BOOLEAN NOT NULL DEFAULT false,
    `builtinKey` VARCHAR(80) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SensitiveRule_builtinKey_key`(`builtinKey`),
    INDEX `SensitiveRule_enabled_direction_idx`(`enabled`, `direction`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SensitivePolicyRule` (
    `policyId` VARCHAR(191) NOT NULL,
    `ruleId` VARCHAR(191) NOT NULL,

    INDEX `SensitivePolicyRule_ruleId_idx`(`ruleId`),
    PRIMARY KEY (`policyId`, `ruleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RequestLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `requestId` VARCHAR(100) NOT NULL,
    `keyId` VARCHAR(64) NULL,
    `keyName` VARCHAR(100) NULL,
    `modelRequested` VARCHAR(200) NOT NULL,
    `providerId` VARCHAR(64) NULL,
    `providerName` VARCHAR(100) NULL,
    `upstreamModel` VARCHAR(200) NULL,
    `endpoint` VARCHAR(100) NOT NULL,
    `stream` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('SUCCESS', 'ERROR', 'BLOCKED', 'CANCELLED') NOT NULL DEFAULT 'SUCCESS',
    `httpStatus` INTEGER NOT NULL DEFAULT 200,
    `errorCode` VARCHAR(100) NULL,
    `errorMessage` TEXT NULL,
    `latencyMs` INTEGER NOT NULL DEFAULT 0,
    `ttftMs` INTEGER NULL,
    `inputTokens` INTEGER NULL,
    `outputTokens` INTEGER NULL,
    `totalTokens` INTEGER NULL,
    `usageEstimated` BOOLEAN NOT NULL DEFAULT false,
    `costEstimate` DECIMAL(14, 8) NULL,
    `clientIp` VARCHAR(64) NULL,
    `userAgent` TEXT NULL,
    `requestBytes` INTEGER NULL,
    `responseBytes` INTEGER NULL,
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `attempts` JSON NULL,
    `intercepted` BOOLEAN NOT NULL DEFAULT false,
    `interceptDirection` ENUM('INPUT', 'OUTPUT') NULL,
    `interceptAction` ENUM('BLOCK', 'MASK', 'LOG') NULL,
    `interceptRuleIds` JSON NULL,
    `interceptSummary` TEXT NULL,
    `upstreamRequestId` VARCHAR(200) NULL,
    `traceId` VARCHAR(100) NULL,
    `source` VARCHAR(50) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RequestLog_requestId_key`(`requestId`),
    INDEX `RequestLog_createdAt_idx`(`createdAt`),
    INDEX `RequestLog_keyId_createdAt_idx`(`keyId`, `createdAt`),
    INDEX `RequestLog_modelRequested_createdAt_idx`(`modelRequested`, `createdAt`),
    INDEX `RequestLog_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `RequestLog_intercepted_createdAt_idx`(`intercepted`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RequestLogBody` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `logId` BIGINT NOT NULL,
    `requestBody` JSON NULL,
    `responseBody` JSON NULL,
    `redacted` BOOLEAN NOT NULL DEFAULT true,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RequestLogBody_logId_key`(`logId`),
    INDEX `RequestLogBody_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `adminId` VARCHAR(64) NULL,
    `username` VARCHAR(64) NULL,
    `action` VARCHAR(100) NOT NULL,
    `targetType` VARCHAR(80) NULL,
    `targetId` VARCHAR(100) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_adminId_createdAt_idx`(`adminId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `AdminUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderModel` ADD CONSTRAINT `ProviderModel_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `Provider`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelRoute` ADD CONSTRAINT `ModelRoute_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `Model`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModelRoute` ADD CONSTRAINT `ModelRoute_providerModelId_fkey` FOREIGN KEY (`providerModelId`) REFERENCES `ProviderModel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKey` ADD CONSTRAINT `ApiKey_sensitivePolicyId_fkey` FOREIGN KEY (`sensitivePolicyId`) REFERENCES `SensitivePolicy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKeyModel` ADD CONSTRAINT `ApiKeyModel_apiKeyId_fkey` FOREIGN KEY (`apiKeyId`) REFERENCES `ApiKey`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKeyModel` ADD CONSTRAINT `ApiKeyModel_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `Model`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SensitivePolicyRule` ADD CONSTRAINT `SensitivePolicyRule_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `SensitivePolicy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SensitivePolicyRule` ADD CONSTRAINT `SensitivePolicyRule_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `SensitiveRule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
