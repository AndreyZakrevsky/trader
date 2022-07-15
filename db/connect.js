const mongoose = require('mongoose');
require('dotenv').config();
//mongoose.set('debug', true);

const connectDb  = async ()=>{
    try {
        await mongoose.connect(`${process.env.DB_URL}/${process.env.DB_NAME}`, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
    } catch (err) {
        console.log(`Disconnected with mongoDb ! ${err.message}`)
        return setTimeout( ()=>{ connectDb() }, 5000 )
    }

    return mongoose;
};

connectDb();
const db = mongoose.connection;
db.once("open", () => {
    console.log("Successfully opened the database.", `${process.env.DB_URL}${process.env.DB_NAME}`)
});
process.on('SIGINT', ()=>{
    mongoose.connection.close(()=>{
        console.log("Mongoose default connection is disconnected due to application termination")

        process.exit(0);
    });
});

module.exports = mongoose;



