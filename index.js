const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;
require("dotenv").config();
const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');

app.use(cors());

app.use(express.json());
const stripe = require("stripe")(process.env.STRIPE_SECRET);


// function sendBookingEmail(booking) {

        
//   const { email,treatmentName ,bookedDate,Patientemail} = booking;

//   // let transporter = nodemailer.createTransport({
//   //   host: 'smtp.sendgrid.net',
//   //   port: 587,
//   //   auth: {
//   //     user: "apikey",
//   //     pass: process.env.SENDGRID_API_KEY
//   //   }
//   // })

//   const auth = {
//     auth: {
//       api_key: `${process.env.EMAILGUN_API_KEY}`,
//       domain: `${process.env.EMAIL_SEND_DOMAIN  }`
//     }
//   }
  
//   const transporter = nodemailer.createTransport(mg(auth));

//   transporter.sendMail({
//     from: "SENDER_EMAIL", // verified sender email
//     to: email, // recipient email
//     subject: `Your Treatment for ${treatmentName} is confirmed`, // Subject line
//     text: "Hello world!", // plain text body
//     html: `
//   <p>Dear ${Patientemail} </p>

//     <h3>Your Appoinment is Confirmed</h3>
//     <div>
    
//     <p>Your appoinment for : ${treatmentName}</p>
//     <p> Please Vist us on ${bookedDate}</p>
//     <p>Thanks from Doctors Portal</p>

//     </div>
    
    
//     `, // html body
//   }, function (error, info) {
//     if (error) {
//       console.log(error);
//     } else {
//       console.log('Email sent: ' + info.response);
//     }
//   });
// }


function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).send("Unathorized Access");
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.SECRET_TOKEN, function (err, decoded) {
    if (err) {
      res.status(403).send("Forbidden Access");
    }
    req.decoded = decoded;
    next();
  });
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.fpgnyx0.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    const doctorsApoinmentCollection = client
      .db("doctorsPortal")
      .collection("AppoinmentOptions");
    const bookingsCollection = client.db("doctorsPortal").collection("booking");
    const usersCollection = client.db("doctorsPortal").collection("users");
    const doctorsCollection = client.db("doctorsPortal").collection("doctors");
    const paymentsCollection = client.db("doctorsPortal").collection("payments");


    // Verify Admin Api

    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      console.log(decodedEmail);
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        res.status(403).send({ message: "Forbiddn Access" });
      }
      next();
    };


    // Strip Api

    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      // console.log('api hit',req.headers)
      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency: "usd",
        amount: amount,

        "payment_method_types": ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Adding Payment Details to Db

    app.post('/payments', async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment)
      const id = payment.bookingID
      const filter = { _id: ObjectId(id) }
      const updateDoc = {
        $set: {
          paid: true,
          transactionID: payment.transactionID,
        }
      }
      const updatedResult = await bookingsCollection.updateOne(filter, updateDoc)
      res.send(result)
    })


    // User Jwt Api
    app.put("/user/:email", async (req, res) => {
      try {
          const email = req.params.email;

          // check the req
          const query = { email: email }
          const existingUser = await usersCollection.findOne(query)
        
          if (existingUser) {
              const token = jwt.sign(
                  { email: email },
                  process.env.SECRET_TOKEN,
                  { expiresIn: "1d" }
              )
              return res.send({ data: token  })
          }
          
          else {
                
          const user = req.body;
          const filter = { email: email };
          const options = { upsert: true };
          const updateDoc = {
              $set: user
          }
          const result = await usersCollection.updateOne(filter, updateDoc, options);

          // token generate 
          const token = jwt.sign(
              { email: email },
              process.env.SECRET_TOKEN,
              { expiresIn: "1d" }
          )
         return  res.send({ data: token   })

          }



      }
      catch (err) {
          console.log(err)
      }
  })

    // JWT taken API

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.SECRET_TOKEN, {
          expiresIn: "7d",
        });
        return res.send({ accessToken: token });
      }
      console.log(user);
      res.status(403).send({ accessToken: "Forbidden" });
    });


    // Appoinemts Card API

    app.get("/appoinmentOptions", async (req, res) => {
      const date = req.query.date;

      const query = {};
      const options = await doctorsApoinmentCollection.find(query).toArray();
      const bookingQuery = { bookedDate: date };

      const alreadyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();

      options.forEach(option => {
        const bookedOption = alreadyBooked.filter(
          book => book.treatmentName === option.name
        );
        const bookedSlot = bookedOption.map(book => book.slot);
        const remainingSlots = option.slots.filter(
          slot => !bookedSlot.includes(slot)
        );
        option.slots = remainingSlots;
      });
      res.send(options);
    });

    // UPDATE pRICE

    // app.get("/addPrice", async (req, res) => {
    //   const filter = {};
    //   const option = { upsert: true };
    //   const updateDoc = {
    //     $set: {
    //       price: 99,
    //     },
    //   };
    //   const result = await doctorsApoinmentCollection.updateMany(
    //     filter,
    //     updateDoc,
    //     option
    //   );
    //   res.send(result);
    // });


    // Getting Doctors Sepeciality API

    app.get("/specialty", async (req, res) => {
      const query = {};
      const result = await doctorsApoinmentCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(result);
    });

    // Getting Bookins Email Wise

    app.get("/bookings", verifyJWT, async (req, res) => {
      // const decodedEmail = req.decoded.email;
      // console.log(req.decoded.email);
      const email = req.query.email;
      const date = req.query.date
      // if (email !== decodedEmail) {
      //   res.status(403).send("Email NOT verified");
      // }



      const query = {
        Patientemail: email,
        bookedDate: date
      };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    // Delete Bookings 
    // app.get('/bookingss', async (req, res) => {
    //   const query = {}
    //   const result = await bookingsCollection.deleteMany(query);
    //   res.send(result)
    // })

    // Getting Single Booking
    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });


    // Posting Booking Details
    app.post("/bookings", async (req, res) => {
      const body = req.body;
      const query = {
        bookedDate: body.bookedDate,
        Patientemail: body.Patientemail,
        treatmentName: body.treatmentName,
      };
      const alreadyBooked = await bookingsCollection.find(query).toArray();
      if (alreadyBooked.length) {
        const message = `You already have a book on ${body.bookedDate}`;
        return res.send({ acknowledged: false, message });
      }
      const result = await bookingsCollection.insertOne(body);
      // sendBookingEmail(body)
      res.send(result);
    });

    // Adding user details to Database 
    app.post("/users", async (req, res) => {
      const body = req.body;
      const email = body.email;
      console.log(email)
      const result = await usersCollection.insertOne(body);
      res.send(result);
    });

    // Getting User Details
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });

    // delete Users
    app.delete('/users/:id',verifyJWT,verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) }
      const result = await usersCollection.deleteOne(query);
      res.send(result)
    })


    // Verify Admin email
    app.get("/user/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });

    // Adding Aadmin Role
    app.put("/users/admin/:id", verifyJWT, async (req, res) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        res.status(403).send({ message: "Forbiddn Access" });
      }
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const option = { upsert: true };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };

      const result = await usersCollection.updateOne(filter, updateDoc, option);
      res.send(result);
    });

    // Getting Doctors Details 
    app.get("/doctors", async (req, res) => {
      const query = {};
      const result = await doctorsCollection.find(query).toArray();
      res.send(result);
    });

    // Posting New Doctors 
    app.post("/doctors", async (req, res) => {
      const body = req.body;
      const result = await doctorsCollection.insertOne(body);
      res.send(result);
    });

    // Deleting Doctors
    app.delete("/doctors/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    });
  } finally {
  }
}
run().catch();

app.get("/", (req, res) => {
  res.send("Server is runnig");
});

app.listen(port, () => {
  console.log(`server is running on port${port}`);
});
