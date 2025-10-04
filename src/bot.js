import 'dotenv/config';
import ccxt from 'ccxt';
import { Telegraf, Markup } from 'telegraf';
import { DatabaseLocal } from './services/db.service.js';
import Big from 'big.js';

export class BinanceTrader {
    constructor(tradeConfig) {
        this.configTrade = tradeConfig;
        this.market = `${tradeConfig.asset}/${tradeConfig.base}`;
        this.clearanceSellPercent = Number(tradeConfig.clearanceSell);
        this.clearanceBuyPercent = Number(tradeConfig.clearanceBuy);
        this.maxVolume = Number(tradeConfig.maxVolume);
        this.volume = Number(tradeConfig.volume);
        this.binanceClient = new ccxt.binance({
            apiKey: process.env.API_KEY,
            secret: process.env.API_SECRET,
        });

        this.dbService = new DatabaseLocal(tradeConfig.asset);
        this.isCryptoTrading = !Boolean(tradeConfig.maxAssetOrderByUsd);
        this.averageBuyPrice = 0;
        this.buyAmount = 0;
        this.totalSpent = 0;
        this.tickCount = 0;
        this.currentMarketPrice = 0;
        this.isTrading = false;

        this.tg_bot = new Telegraf(process.env.TG_TOKEN);
        this.tg_bot.launch();
        process.once('SIGINT', () => this.tg_bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.tg_bot.stop('SIGTERM'));

        this._setupBotInterface();
    }

    async tick() {
        while (this.isTrading) {
            await this._sleep(this.configTrade.tickInterval);
            this.tickCount += 1;
            await this._trade();
        }
    }

    async _trade() {
        const baseBalance = await this._getBaseBalance();
        const assetBalance = await this._getAssetBalance();
        const { averageBayPrice = 0, amount = 0, totalSpent = 0 } = await this.dbService.getData();

        this.averageBuyPrice = averageBayPrice;
        this.buyAmount = amount;
        this.totalSpent = totalSpent;
        this.currentMarketPrice = await this._getLastMarketPrice();

        if (!this.currentMarketPrice || !this.isTrading) return;

        const minBuyVolume = this._computeBuyVolume(this.currentMarketPrice);

        if (!this.averageBuyPrice) return await this._buy(minBuyVolume, true);

        const priceDifference = new Big(this.currentMarketPrice).minus(new Big(this.averageBuyPrice));

        if (priceDifference.gt(0)) {
            if (!assetBalance) {
                console.log('Can not SELL, Empty base balance!!!');
                return;
            }
            const clearanceSellThreshold = new Big(this.averageBuyPrice).times(new Big(this.clearanceSellPercent));
            if (clearanceSellThreshold.lt(this.currentMarketPrice)) {
                const amountToSell = Math.floor(assetBalance) || this.buyAmount;
                await this._sell(amountToSell);
            }
        } else {
            if (!baseBalance || new Big(baseBalance).lt(this.volume) || this.maxVolume < this.buyAmount) {
                console.log('Can not BUY, Empty base balance, or limit reached!');
                return;
            }

            const clearanceBuyPercent = this.getProgressiveBuyPercent(this.totalSpent, this.clearanceBuyPercent);
            const clearanceBuyThreshold = new Big(this.averageBuyPrice).times(new Big(clearanceBuyPercent));

            if (clearanceBuyThreshold.gte(this.currentMarketPrice)) {
                await this._buy(minBuyVolume);
            }
        }
    }

    async _sell(amount) {
        try {
            const { status } = await this.binanceClient.createMarketSellOrder(this.market, amount);
            if (status === 'closed') {
                await this.dbService.cleanUp();
            }
        } catch (e) {
            console.log('SELL || ', e.message);
        }
    }

    async _buy(amount) {
        try {
            const { status, fee, price } = await this.binanceClient.createMarketBuyOrder(this.market, amount);

            if (status === 'closed') return await this.dbService.setData(amount, price, fee?.cost || 0);
        } catch (e) {
            console.log('BUY || ', e.message);
        }
    }

    getProgressiveBuyPercent(total, clearanceBuyPercent = 0.97) {
        const step = 0.05;
        const totalStep = total < 0 ? 0 : total;
        const buckets = Math.floor(totalStep / 100);
        const percent = clearanceBuyPercent - step * buckets;
        return Math.max(percent, 0);
    }

    async _getBaseBalance() {
        try {
            const { info } = await this.binanceClient.fetchBalance({ type: 'account' });
            const { free } = info.balances.find((item) => item.asset === this.configTrade.base);
            return free ? Number(free) : null;
        } catch (e) {
            console.log('BASE BALANCE || ', e.message);
            return null;
        }
    }

    async _getAssetBalance() {
        try {
            const { info } = await this.binanceClient.fetchBalance({ type: 'account' });
            const { free } = info.balances.find((item) => item.asset === this.configTrade.asset);
            return free ? Number(free) : null;
        } catch (e) {
            console.log('ASSET BALANCE || ', e.message);
            return null;
        }
    }

    _computeBuyVolume(marketPrice) {
        let counterVolume = 0;
        let necessaryUsdVolume = 0;

        while (necessaryUsdVolume < this.volume) {
            counterVolume++;
            necessaryUsdVolume = necessaryUsdVolume + +marketPrice;
        }

        return counterVolume;
    }

    async _getLastMarketPrice() {
        try {
            const {
                info: { lastPrice = null },
            } = await this.binanceClient.fetchTicker(this.market);
            return Number(lastPrice);
        } catch (e) {
            return null;
        }
    }

    _sleep(time) {
        return new Promise((resolve) => setTimeout(resolve, time));
    }

    _setupBotInterface() {
        this.tg_bot.start(async (ctx) => {
            await ctx.reply(
                'Welcome to Binance Trader Bot! Use the buttons below to control the bot.',
                Markup.keyboard([
                    ['Start Trading', 'Stop Trading'],
                    ['Status', 'Clean'],
                ])
                    .resize()
                    .persistent()
            );
        });

        this.tg_bot.hears('Start Trading', async (ctx) => {
            if (this.isTrading) {
                return await ctx.reply('❗ Trading is already running.');
            }

            this.isTrading = true;
            ctx.reply('✅ Trading has started!');
            this.tick();
        });

        this.tg_bot.hears('Stop Trading', async (ctx) => {
            if (!this.isTrading) {
                return ctx.reply('❗ Trading is already stopped.');
            }

            this.isTrading = false;
            ctx.reply('🛑 Trading has stopped!');
        });

        this.tg_bot.hears('Status', async (ctx) => {
            const operationData = await this.dbService.getData();
            const expectedPriceToSell = new Big(this.averageBuyPrice).times(new Big(this.clearanceSellPercent)).round(8);
            const expectedPriceToBuy = new Big(this.averageBuyPrice).times(new Big(this.getProgressiveBuyPercent(this.totalSpent || 0, this.clearanceBuyPercent))).round(8);
            const profit = new Big(expectedPriceToSell)
                .times(new Big(operationData.amount))
                .minus(operationData.totalSpent)
                .minus(operationData?.fee * 2 || 0)
                .round(8);

            const profitCurrent = new Big(this.currentMarketPrice)
                .times(new Big(operationData.amount))
                .minus(operationData.totalSpent)
                .minus(operationData?.fee * 2 || 0)
                .round(8);

            const extendedInfo = `
Status:   ${this.isTrading ? '✅ Running' : '🛑 Stopped'}
Market:   ${this.market}
Current market price:  ${this.currentMarketPrice || 0}
Average buy price:  ${operationData.averageBayPrice}
Total spent:  ${operationData.totalSpent || 0}
Amount:  ${operationData.amount || 0}
Fee:  ${operationData.fee || 0}
Sell: ${this.clearanceSellPercent || 0} %
Buy origin: ${this.clearanceBuyPercent || 0}  %
Buy progressive: ${this.getProgressiveBuyPercent(this.totalSpent || 0, this.clearanceBuyPercent)} %
Step in base: ${this.volume}
Max Volume: ${this.maxVolume}

SELL CONDITION (price): > ${expectedPriceToSell}
BUY CONDITION (price): < ${expectedPriceToBuy}
EXPECTED PROFIT:  ${profit}
CURRENT PROFIT:  ${profitCurrent}`;

            ctx.reply(extendedInfo);
        });

        this.tg_bot.hears('Clean', async (ctx) => {
            await ctx.reply(
                '⚠️ Are you sure you want to clean the database?',
                Markup.inlineKeyboard([Markup.button.callback('Yes', 'clean_confirm'), Markup.button.callback('No', 'clean_cancel')])
            );
        });

        this.tg_bot.action('clean_confirm', async (ctx) => {
            this.isTrading = false;
            await this.dbService.cleanUp();
            ctx.reply('✅ Database cleaned successfully.');
        });

        this.tg_bot.action('clean_cancel', async (ctx) => {
            ctx.reply('❌ Clean operation canceled.');
        });

        this.tg_bot.command('set', async (ctx) => {
            const text = ctx.message.text;
            const params = text.split(' ').slice(1);
            const {
                buy = null,
                sell = null,
                volume = null,
                max_volume = null,
            } = params.reduce((acc, param) => {
                const [key, value] = param.split('=');
                acc[key] = value;
                return acc;
            }, {});

            this.clearanceSellPercent = Number(sell) || this.clearanceSellPercent;
            this.clearanceBuyPercent = Number(buy) || this.clearanceBuyPercent;
            this.volume = Number(volume) || this.volume;
            this.maxVolume = Number(max_volume) || this.maxVolume;

            if (sell || buy || volume || max_volume) {
                this.isTrading = false;
                ctx.reply('✅ You changed percentage, the bot is stopped. Run bot to start trading with new percentage.');
            }
        });
    }
}
