import 'dotenv/config';
import { BinanceTrader } from './src/bot.js';

const config = {
    asset: process.env.ASSET,
    base: process.env.BASE,
    clearanceSell: process.env.SELL_PERCENT,
    clearanceBuy: process.env.BUY_PERCENT,
    tickInterval: process.env.TICK_INTERVAL,
    volume: process.env.VOLUME,
    maxVolume: process.env.MAX_VOLUME,
};

const binanceTrader = new BinanceTrader(config);
binanceTrader.tick();
