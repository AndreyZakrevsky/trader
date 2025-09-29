import { BinanceTrader } from './src/bot.js';

const config = {
    asset: 'FF',
    base: 'USDT',
    clearanceSell: 1.025,
    clearanceBuy: 0.97,
    tickInterval: 5000,
    volume: 10,
};

const binanceTrader = new BinanceTrader(config);
binanceTrader.tick();
