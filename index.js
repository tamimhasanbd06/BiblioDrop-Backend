require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 8000;

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? require("stripe")(stripeSecretKey) : null;

const allowedOrigins = [
  process.env.CLIENT_URL || "http://localhost:3000",
  process.env.CLIENT_URL_ALT || "http://localhost:3001",
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

const uri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET;
const dbName = process.env.MONGODB_DB || "biblioteca";
const cookieName = process.env.JWT_COOKIE_NAME || "bd_token";

if (!uri || !jwtSecret) {
  console.error("Missing MONGODB_URI or JWT_SECRET in .env file");
  process.exit(1);
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let usersCollection;
let booksCollection;
let deliveriesCollection;
let reviewsCollection;
let transactionsCollection;
let wishlistsCollection;
let sellingBooksCollection; 

const isValidObjectId = (id) => Boolean(id && ObjectId.isValid(id));

const buildBookFilter = (idParameter) => {
  if (isValidObjectId(idParameter)) {
    return { _id: new ObjectId(idParameter) };
  }
  return { bookId: idParameter };
};

const verifyJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    const cookieToken = req.cookies?.[cookieName] || req.cookies?.bd_token;
    const token = bearerToken || cookieToken;

    if (!token) {
      return res.status(401).send({
        success: false,
        message: "Unauthorized. JWT token missing.",
      });
    }

    const decoded = jwt.verify(token, jwtSecret);
    const dbUser = usersCollection && decoded.email ? await usersCollection.findOne({ email: decoded.email }) : null;
    req.user = {
      ...decoded,
      ...(dbUser || {}),
      role: dbUser?.role || decoded.role || "user",
      email: dbUser?.email || decoded.email,
      name: dbUser?.name || decoded.name,
      image: dbUser?.image || decoded.image || decoded.photo || "",
    };
    next();
  } catch (error) {
    return res.status(401).send({
      success: false,
      message: "Unauthorized. Invalid or expired JWT token.",
    });
  }
};

const verifyLibrarianOrAdmin = (req, res, next) => {
  if (req.user?.role === "librarian" || req.user?.role === "admin") return next();
  return res.status(403).send({ success: false, message: "Forbidden. Librarian or Admin access required." });
};

const verifyAdmin = (req, res, next) => {
  if (req.user?.role === "admin") return next();
  return res.status(403).send({ success: false, message: "Forbidden. Admin access required." });
};

const isBookOwner = (book, email) => {
  return Boolean(email && (book?.librarianEmail === email || book?.ownerEmail === email));
};

const getPaginationOptions = (query = {}, defaultLimit = 12) => {
  const currentPage = Math.max(Number(query.page) || 1, 1);
  const perPage = Math.min(Math.max(Number(query.limit) || defaultLimit, 1), 12);
  const skip = (currentPage - 1) * perPage;
  return { currentPage, perPage, skip };
};

const sendPaginatedResponse = async ({ collection, query, sort, pageQuery, key, res, projection }) => {
  const { currentPage, perPage, skip } = getPaginationOptions(pageQuery, 12);
  const totalItems = await collection.countDocuments(query);
  let cursor = collection.find(query);
  if (projection) cursor = cursor.project(projection);
  const items = await cursor.sort(sort || { createdAt: -1 }).skip(skip).limit(perPage).toArray();
  res.send({
    success: true,
    [key]: items,
    pagination: {
      totalItems,
      totalBooks: totalItems,
      currentPage,
      perPage,
      totalPages: Math.max(Math.ceil(totalItems / perPage), 1),
    },
  });
};

app.get("/", (req, res) => {
  res.send("BiblioDrop Server is Running");
});

app.get("/me", verifyJWT, async (req, res) => {
  try {
    const dbUser = await usersCollection.findOne({ email: req.user.email });
    res.send({
      success: true,
      user: {
        ...req.user,
        ...(dbUser || {}),
        role: dbUser?.role || req.user.role || "user",
      },
    });
  } catch {
    res.send({ success: true, user: req.user });
  }
});

app.get("/profile", verifyJWT, async (req, res) => {
  try {
    const user = await usersCollection.findOne({ email: req.user.email }, { projection: { password: 0 } });
    if (!user) return res.status(404).send({ success: false, message: "Profile not found" });
    res.send({ success: true, user });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

app.patch("/profile", verifyJWT, async (req, res) => {
  try {
    const { name, image, phone, address, bio } = req.body || {};
    const updateData = {
      ...(typeof name === "string" ? { name: name.trim() } : {}),
      ...(typeof image === "string" ? { image: image.trim() } : {}),
      ...(typeof phone === "string" ? { phone: phone.trim() } : {}),
      ...(typeof address === "string" ? { address: address.trim() } : {}),
      ...(typeof bio === "string" ? { bio: bio.trim() } : {}),
      updatedAt: new Date(),
    };
    const result = await usersCollection.updateOne({ email: req.user.email }, { $set: updateData });
    const user = await usersCollection.findOne({ email: req.user.email }, { projection: { password: 0 } });
    res.send({ success: true, modifiedCount: result.modifiedCount, user, message: "Profile updated successfully" });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

async function run() {
  try {
    await client.connect();

    const database = client.db(dbName);
    usersCollection = database.collection("users");
    booksCollection = database.collection("books");
    deliveriesCollection = database.collection("deliveries");
    reviewsCollection = database.collection("reviews");
    transactionsCollection = database.collection("transactions");
    wishlistsCollection = database.collection("wishlists");
    sellingBooksCollection = database.collection("selling_books");

    console.log(`MongoDB Connected Successfully: ${dbName}`);

    // ============================================================
    // BROWSE BOOKS (ONLY APPROVED/PUBLISHED ARE SHOWN - NO PENDING)
    // ============================================================
    app.get("/books", async (req, res) => {
      try {
        const {
          search = "",
          category = "All",
          availability = "All",
          minFee = "",
          maxFee = "",
          sort = "latest",
          page = 1,
          limit = 8,
        } = req.query;

        const currentPage = Math.max(Number(page) || 1, 1);
        const perPage = Math.min(Math.max(Number(limit) || 8, 6), 12);
        const skip = (currentPage - 1) * perPage;

        const query = { approvalStatus: { $in: ["Approved", "Published"] } };

        if (search.trim()) {
          query.$or = [
            { title: { $regex: search.trim(), $options: "i" } },
            { author: { $regex: search.trim(), $options: "i" } },
            { bookId: { $regex: search.trim(), $options: "i" } },
          ];
        }

        if (category !== "All") query.category = category;
        if (availability !== "All") query.availabilityStatus = availability;

        if (minFee !== "" || maxFee !== "") {
          query.deliveryFee = {};
          if (minFee !== "") query.deliveryFee.$gte = Number(minFee);
          if (maxFee !== "") query.deliveryFee.$lte = Number(maxFee);
        }

        let sortOption = { createdAt: -1 };
        if (sort === "name") sortOption = { title: 1 };
        if (sort === "fee-low") sortOption = { deliveryFee: 1 };
        if (sort === "fee-high") sortOption = { deliveryFee: -1 };
        if (sort === "rating") sortOption = { rating: -1 };

        const totalBooks = await booksCollection.countDocuments(query);
        const books = await booksCollection.find(query).sort(sortOption).skip(skip).limit(perPage).toArray();

        res.send({
          success: true,
          books,
          pagination: {
            totalBooks,
            currentPage,
            perPage,
            totalPages: Math.max(Math.ceil(totalBooks / perPage), 1),
          },
        });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ============================================================
    // FEATURED BOOKS (ONLY APPROVED/PUBLISHED ARE SHOWN - NO PENDING)
    // ============================================================
    app.get("/featured-books", async (req, res) => {
      try {
        const books = await booksCollection.find({ approvalStatus: { $in: ["Approved", "Published"] } }).sort({ createdAt: -1 }).limit(6).toArray();
        res.send({ success: true, books });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ============================================================
    // LIBRARIAN ADD BOOK (FULL COMPATIBLE DATA STRUCTURE)
    // ============================================================
    app.post("/books", verifyJWT, verifyLibrarianOrAdmin, async (req, res) => {
      try {
        const book = req.body;
        if (!book.title || !book.author || !book.category || !book.image || !book.description) {
          return res.status(400).send({ success: false, message: "Title, author, category, image and description are required." });
        }

        const newBook = {
          bookId: book.bookId || `BK-${Date.now().toString().slice(-6)}`,
          title: book.title.trim(),
          author: book.author.trim(),
          category: book.category,
          publisher: book.publisher || "",
          language: book.language || "English",
          isbn: book.isbn || "",
          pages: Number(book.pages || 0),
          image: book.image,
          description: book.description,
          deliveryFee: Number(book.deliveryFee || 0),
          availabilityStatus: book.availabilityStatus || "Available",
          approvalStatus: "Pending", 
          rating: Number(book.rating || 0),
          totalReviews: Number(book.totalReviews || 0),
          totalDeliveries: Number(book.totalDeliveries || 0),
          ownerName: book.ownerName || req.user.name,
          ownerEmail: req.user.email,
          ownerPhoto: book.ownerPhoto || req.user.image || req.user.photo || "",
          librarianName: req.user.name,
          librarianEmail: req.user.email,
          librarianId: req.user.userId || req.user.id || null,
          createdAt: book.createdAt ? new Date(book.createdAt) : new Date(),
          updatedAt: book.updatedAt ? new Date(book.updatedAt) : new Date(),
        };

        const result = await booksCollection.insertOne(newBook);
        res.status(201).send({ success: true, insertedId: result.insertedId, message: "Book added successfully. Waiting for admin approval." });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ============================================================
    // LIBRARIAN EDIT BOOK (DIRECTLY PUSH TO BOOKS COLLECTION)
    // ============================================================
    app.put("/books/:id", verifyJWT, verifyLibrarianOrAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const lookupQuery = buildBookFilter(id);
        const book = await booksCollection.findOne(lookupQuery);
        if (!book) return res.status(404).send({ success: false, message: "Book record not found." });

        if (req.user.role !== "admin" && book.librarianEmail !== req.user.email) {
          return res.status(403).send({ success: false, message: "Unauthorized. You can only edit your own books." });
        }

        const { title, author, description, deliveryFee, category, publisher, language, isbn, pages, image, ownerName, ownerPhoto } = req.body;
        
        const updateDoc = {
          $set: {
            title: title ? title.trim() : book.title,
            author: author ? author.trim() : book.author,
            description: description || book.description,
            deliveryFee: deliveryFee !== undefined ? parseFloat(deliveryFee) : book.deliveryFee,
            category: category || book.category,
            publisher: publisher || book.publisher,
            language: language || book.language,
            isbn: isbn || book.isbn,
            pages: pages !== undefined ? parseInt(pages) : book.pages,
            image: image || book.image,
            ownerName: ownerName ? ownerName.trim() : book.ownerName,
            ownerPhoto: ownerPhoto || book.ownerPhoto,
            updatedAt: new Date()
          }
        };

        const result = await booksCollection.updateOne({ _id: book._id }, updateDoc);
        res.send({ success: true, modifiedCount: result.modifiedCount, message: "Book data updated directly into database." });
      } catch (error) {
        return res.status(500).send({ success: false, message: error.message });
      }
    });

    // ============================================================
    // LIBRARIAN GET INVENTORY ROUTE WITH PAGINATION
    // ============================================================
    app.get("/dashboard/librarian/books", verifyJWT, verifyLibrarianOrAdmin, async (req, res) => {
      try {
        const { page = 1, limit = 12 } = req.query;
        const query = req.user.role === "admin" ? {} : { librarianEmail: req.user.email };
        
        await sendPaginatedResponse({
          collection: booksCollection,
          query,
          sort: { createdAt: -1 },
          pageQuery: { page, limit },
          key: "books",
          res
        });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ============================================================
    // LIBRARIAN TOGGLE PUBLISH/UNPUBLISHED STATUS (STRICT FILTER)
    // ============================================================
    app.patch("/dashboard/librarian/books/:id/toggle-publish", verifyJWT, verifyLibrarianOrAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const lookupQuery = buildBookFilter(id);
        const book = await booksCollection.findOne(lookupQuery);

        if (!book) return res.status(404).send({ success: false, message: "Book entity not found" });

        if (book.approvalStatus === "Pending" || book.approvalStatus === "Pending Approval") {
          return res.status(403).send({ success: false, message: "Action Denied: Book is pending admin approval." });
        }

        const nextStatus = book.approvalStatus === "Published" || book.approvalStatus === "Approved" 
          ? "Unpublished" 
          : "Published";

        const result = await booksCollection.updateOne(
          { _id: book._id },
          { $set: { approvalStatus: nextStatus, updatedAt: new Date() } }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount, message: `Status updated to ${nextStatus}` });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ============================================================
    // BOOK DETAILS PAGE DISCOVERY
    // ============================================================
    app.get("/books/:id", async (req, res) => {
      try {
        const lookupQuery = buildBookFilter(req.params.id);
        const book = await booksCollection.findOne(lookupQuery);
        if (!book) return res.status(404).send({ success: false, message: "Book not found" });
        res.send({ success: true, book });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.patch("/books/:id/status", verifyJWT, verifyLibrarianOrAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const { availabilityStatus } = req.body;
        if (!availabilityStatus) return res.status(400).send({ success: false, message: "availabilityStatus is required." });

        const lookupQuery = buildBookFilter(id);
        const book = await booksCollection.findOne(lookupQuery);
        if (!book) return res.status(404).send({ success: false, message: "Book record not found." });

        const result = await booksCollection.updateOne({ _id: book._id }, { $set: { availabilityStatus, updatedAt: new Date() } });
        res.send({ success: true, modifiedCount: result.modifiedCount, message: `Status updated to ${availabilityStatus} globally.` });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.delete("/books/:id", verifyJWT, verifyLibrarianOrAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const lookupQuery = buildBookFilter(id);
        const book = await booksCollection.findOne(lookupQuery);
        if (!book) return res.status(404).send({ success: false, message: "Book record not found." });

        const result = await booksCollection.deleteOne({ _id: book._id });
        res.send({ success: true, deletedCount: result.deletedCount, message: "Book permanently deleted from MongoDB globally." });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/categories", async (req, res) => {
      try {
        const categories = await booksCollection.distinct("category", { approvalStatus: { $in: ["Approved", "Published"] } });
        res.send({ success: true, categories: categories.filter(Boolean).sort() });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.patch("/books/:id/approve", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const lookupQuery = buildBookFilter(req.params.id);
        const book = await booksCollection.findOne(lookupQuery);
        if (!book) return res.status(404).send({ success: false, message: "Book not found" });

        const result = await booksCollection.updateOne(
          { _id: book._id },
          { $set: { approvalStatus: "Approved", availabilityStatus: "Available", updatedAt: new Date() } }
        );
        res.send({ success: true, modifiedCount: result.modifiedCount, approvalStatus: "Approved", message: "Book approved successfully" });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.post("/create-checkout-session", verifyJWT, async (req, res) => {
      try {
        if (!stripe) return res.status(500).send({ success: false, message: "Stripe is not configured. Add STRIPE_SECRET_KEY." });

        const { bookId } = req.body;
        const lookupQuery = buildBookFilter(bookId);

        const book = await booksCollection.findOne(lookupQuery);
        if (!book) return res.status(404).send({ success: false, message: "Book not found" });
        if (!["Approved", "Published"].includes(book.approvalStatus)) return res.status(400).send({ success: false, message: "This book is not published yet." });
        if (book.availabilityStatus !== "Available") return res.status(400).send({ success: false, message: "Book is not available." });
        if (isBookOwner(book, req.user.email)) return res.status(403).send({ success: false, message: "Owner cannot request own book." });

        const originalFee = Number(book.deliveryFee || 0);
        const safeFee = originalFee < 65 ? 65 : originalFee; 
        const clientURL = process.env.CLIENT_URL || "http://localhost:3000";

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: req.user.email,
          line_items: [
            {
              price_data: {
                currency: "bdt",
                product_data: {
                  name: book.title,
                  description: originalFee < 65 
                    ? `Delivery fee for ${book.title} (Adjusted to Stripe minimum limit)`
                    : `Delivery fee for ${book.title}`,
                  images: book.image ? [book.image] : [],
                },
                unit_amount: Math.round(safeFee * 100),
              },
              quantity: 1,
            },
          ],
          metadata: {
            bookId: book._id.toString(),
            bookTitle: book.title,
            userEmail: req.user.email,
            userName: req.user.name || "",
            librarianEmail: book.librarianEmail || book.ownerEmail || "",
            librarianName: book.librarianName || book.ownerName || "",
          },
          success_url: `${clientURL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${clientURL}/books/${book._id}`,
        });

        res.send({ success: true, url: session.url, sessionId: session.id });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.post("/payment-success", verifyJWT, async (req, res) => {
      try {
        if (!stripe) return res.status(500).send({ success: false, message: "Stripe is not configured." });
        const { sessionId } = req.body;
        if (!sessionId) return res.status(400).send({ success: false, message: "Session ID is required." });

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (!session || session.payment_status !== "paid") {
          return res.status(400).send({ success: false, message: "Payment is not completed." });
        }

        const existingSale = await sellingBooksCollection.findOne({ transactionId: session.id });
        if (existingSale) {
          const existingDelivery = await deliveriesCollection.findOne({ transactionId: session.id });
          return res.send({ 
            success: true, 
            message: "Payment already processed previously.", 
            transactionId: session.id, 
            delivery: existingDelivery 
          });
        }

        const bookId = session.metadata.bookId;
        const lookupQuery = buildBookFilter(bookId);

        const book = await booksCollection.findOne(lookupQuery);
        if (!book) return res.status(404).send({ success: false, message: "Book not found." });

        const amount = Number(session.amount_total || 0) / 100;
        const paymentSuccessTime = new Date(); 

        const sellingBookData = {
          bookId: book._id.toString(),
          title: book.title, 
          bookTitle: book.title,
          bookAuthor: book.author,
          userEmail: req.user.email,      
          userName: req.user.name || "",   
          librarianEmail: book.librarianEmail || book.ownerEmail || "",
          transactionId: session.id,       
          amountPaid: amount,
          status: "Pending", 
          createdAt: paymentSuccessTime,
          updatedAt: paymentSuccessTime
        };

        const saleResult = await sellingBooksCollection.insertOne(sellingBookData);

        const delivery = {
          bookId: book._id.toString(),
          bookTitle: book.title,
          bookImage: book.image,
          deliveryFee: amount,
          userEmail: req.user.email,
          userName: req.user.name,
          librarianEmail: book.librarianEmail || book.ownerEmail,
          librarianName: book.librarianName || book.ownerName,
          transactionId: session.id,
          status: "Pending", 
          createdAt: paymentSuccessTime,
          updatedAt: paymentSuccessTime,
        };
        const deliveryResult = await deliveriesCollection.insertOne(delivery);

        await booksCollection.updateOne(
          { _id: book._id },
          { $set: { availabilityStatus: "Pending Delivery", updatedAt: paymentSuccessTime }, $inc: { totalDeliveries: 1 } }
        );

        await transactionsCollection.insertOne({
          transactionId: session.id,
          userEmail: req.user.email,
          librarianEmail: book.librarianEmail || book.ownerEmail,
          amount,
          bookId: book._id.toString(),
          bookTitle: book.title,
          createdAt: paymentSuccessTime,
        });

        res.status(201).send({
          success: true,
          insertedId: saleResult.insertedId,
          deliveryId: deliveryResult.insertedId,
          transactionId: session.id,
          message: "Data successfully synced and saved into selling_books collection!",
          data: sellingBookData
        });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/dashboard/user/overview", verifyJWT, async (req, res) => {
      try {
        const email = req.user.email;

        const aggregationResult = await sellingBooksCollection.aggregate([
          { $match: { userEmail: email } },
          {
            $group: {
              _id: null,
              totalSpent: { $sum: { $toDouble: "$amountPaid" } },
              pendingCount: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
              dispatchedCount: { $sum: { $cond: [{ $eq: ["$status", "Dispatched"] }, 1, 0] } },
              deliveredCount: { $sum: { $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0] } }
            }
          }
        ]).toArray();

        const statsData = aggregationResult[0] || { totalSpent: 0, pendingCount: 0, dispatchedCount: 0, deliveredCount: 0 };

        const chartMetrics = [
          { name: "Pending", value: statsData.pendingCount },
          { name: "Dispatched", value: statsData.dispatchedCount },
          { name: "Delivered", value: statsData.deliveredCount }
        ];

        res.send({ 
          success: true, 
          stats: { 
            totalBooksRead: statsData.deliveredCount, 
            pendingDeliveries: statsData.pendingCount, 
            totalSpent: statsData.totalSpent, 
            deliveredBooks: statsData.deliveredCount, 
            chart: chartMetrics 
          } 
        });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/dashboard/user/deliveries", verifyJWT, async (req, res) => {
      try {
        await sendPaginatedResponse({ collection: deliveriesCollection, query: { userEmail: req.user.email }, sort: { createdAt: -1 }, pageQuery: req.query, key: "deliveries", res });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/dashboard/user/reading-list", verifyJWT, async (req, res) => {
      try {
        await sendPaginatedResponse({ collection: deliveriesCollection, query: { userEmail: req.user.email, status: "Delivered" }, sort: { updatedAt: -1, createdAt: -1 }, pageQuery: req.query, key: "books", res });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/dashboard/user/reviews", verifyJWT, async (req, res) => {
      try {
        await sendPaginatedResponse({ collection: reviewsCollection, query: { userEmail: req.user.email }, sort: { createdAt: -1 }, pageQuery: req.query, key: "reviews", res });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/dashboard/librarian/overview", verifyJWT, verifyLibrarianOrAdmin, async (req, res) => {
      try {
        const email = req.user.email;
        
        const totalBooksListed = await booksCollection.countDocuments({ librarianEmail: email });
        const activePendingRequests = await deliveriesCollection.countDocuments({ librarianEmail: email, status: "Pending" });
        const sellingBooksData = await sellingBooksCollection.find({ librarianEmail: email }).toArray();

        res.send({ 
          success: true, 
          stats: { 
            totalBooksListed, 
            activePendingRequests, 
            selling_books: sellingBooksData || [] 
          } 
        });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.post("/api/wishlist/toggle", verifyJWT, async (req, res) => {
      try {
        const { book } = req.body;
        if (!book || !book._id) return res.status(400).send({ success: false, message: "বইয়ের তথ্য পাওয়া যায়নি।" });

        const userEmail = req.user?.email;
        const bookId = book._id;
        const existingWish = await wishlistsCollection.findOne({ userEmail, bookId });

        if (existingWish) {
          await wishlistsCollection.deleteOne({ userEmail, bookId });
          return res.send({ success: true, isWishlisted: false, message: "উইশলিস্ট থেকে সরানো হয়েছে।" });
        } else {
          await wishlistsCollection.insertOne({ userEmail, bookId, bookData: book, addedAt: new Date() });
          return res.status(201).send({ success: true, isWishlisted: true, message: "উইশলিস্টে যুক্ত করা হয়েছে।" });
        }
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/api/wishlist/status/:bookId", verifyJWT, async (req, res) => {
      try {
        const { bookId } = req.params;
        const userEmail = req.user?.email;
        const existingWish = await wishlistsCollection.findOne({ userEmail, bookId });
        res.send({ success: true, isWishlisted: !!existingWish });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

  } catch (error) {
    console.error("Initialization Error:", error);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`BiblioDrop server gateway operational on secure port: ${port}`);
});