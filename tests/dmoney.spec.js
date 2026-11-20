import "dotenv/config";
import axios from "axios";
import { expect } from "chai";
import { faker } from "@faker-js/faker";

const BASE_URL = process.env.baseurl;
const PARTNER_KEY = process.env.partnerkey;

// Return every response (including 4xx) instead of throwing, so tests can assert status codes.
const api = axios.create({
    baseURL: BASE_URL,
    headers: { "Content-Type": "application/json" },
    validateStatus: () => true,
});

const authHeaders = (token) => ({
    headers: {
        Authorization: `Bearer ${token}`,
        "X-AUTH-SECRET-KEY": PARTNER_KEY,
    },
});

// Unique data per run so the suite can be re-run without "user already exists" errors.
const randomDigits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
const newUser = (role) => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    return {
        name: `${firstName} ${lastName}`,
        email: faker.internet.email({ firstName, lastName, provider: "gmail.com" }).toLowerCase(),
        password: "1234",
        phone_number: `017${randomDigits(8)}`,
        nid: randomDigits(10),
        role,
    };
};

// Logs in; if the API requires an OTP step, completes it via /user/verify-otp.
async function login(email, password) {
    const res = await api.post("/user/login", { email, password });
    if (res.data?.token) return res;

    const otp = process.env.default_otp || res.data?.otp;
    return api.post("/user/verify-otp?env=dev", { identifier: email, otp });
}

const users = {
    agent: newUser("Agent"),
    customer1: newUser("Customer"),
    customer2: newUser("Customer"),
    merchant: newUser("Merchant"),
};
const tokens = {};
const UNREGISTERED_PHONE = `019${randomDigits(8)}`;

describe("dMoney integration testing", function () {
    this.timeout(30000);

    before(async () => {
        try {
            await api.get("/");
        } catch (err) {
            throw new Error(`dMoney API is not reachable at ${BASE_URL} (${err.code || err.message}). Start the server first.`);
        }
    });

    describe("1. Admin login", () => {
        it("admin can log in and receive a token", async () => {
            const res = await login(process.env.admin_email, process.env.admin_password);
            expect(res.status).to.equal(200);
            expect(res.data.token).to.be.a("string").and.not.empty;
            tokens.admin = res.data.token;
        });
    });

    describe("2. Create 2 customers, 1 agent and 1 merchant", () => {
        for (const [key, user] of Object.entries(users)) {
            it(`registers ${user.role} (${key})`, async () => {
                const res = await api.post("/user/register", user);
                expect(res.status).to.equal(201);
                expect(res.data.user.email).to.equal(user.email);
                expect(res.data.user.role).to.equal(user.role);
                expect(res.data.user.status).to.equal("pending");
                user.id = res.data.user.id;
            });
        }

        it("rejects registering a duplicate user", async () => {
            const res = await api.post("/user/register", users.customer1);
            expect(res.status).to.equal(208);
        });
    });

    describe("3. Admin activates the users", () => {
        for (const key of Object.keys(users)) {
            it(`activates ${key}`, async () => {
                const res = await api.patch(
                    `/user/update/${users[key].id}`,
                    { status: "active" },
                    authHeaders(tokens.admin)
                );
                expect(res.status).to.equal(200);
                expect(res.data.message).to.equal("User updated successfully");
                expect(res.data.user.status).to.equal("active");
            });
        }

        for (const key of Object.keys(users)) {
            it(`${key} can log in after activation`, async () => {
                const res = await login(users[key].email, users[key].password);
                expect(res.status).to.equal(200);
                expect(res.data.token).to.be.a("string").and.not.empty;
                tokens[key] = res.data.token;
            });
        }
    });

    describe("4. System deposits 5000 tk to agent", () => {
        it("system account logs in", async () => {
            const res = await login(process.env.system_email, process.env.system_password);
            expect(res.status).to.equal(200);
            expect(res.data.token).to.be.a("string").and.not.empty;
            tokens.system = res.data.token;
        });

        it("deposits 5000 tk from SYSTEM to agent", async () => {
            const res = await api.post(
                "/transaction/deposit",
                { from_account: "SYSTEM", to_account: users.agent.phone_number, amount: 5000 },
                authHeaders(tokens.system)
            );
            expect(res.status).to.equal(201);
        });
    });

    describe("5. Agent deposits 2000 tk to customer 1", () => {
        it("deposits 2000 tk and earns 2.5% commission", async () => {
            const amount = 2000;
            const res = await api.post(
                "/transaction/deposit",
                { from_account: users.agent.phone_number, to_account: users.customer1.phone_number, amount },
                authHeaders(tokens.agent)
            );
            expect(res.status).to.equal(201);
            expect(res.data.commission).to.be.a("number");
            expect(res.data.commission).to.be.closeTo(amount * 0.025, 0.01);
        });

        it("rejects deposit below the minimum amount", async () => {
            const res = await api.post(
                "/transaction/deposit",
                { from_account: users.agent.phone_number, to_account: users.customer1.phone_number, amount: 5 },
                authHeaders(tokens.agent)
            );
            expect(res.status).to.equal(400);
            expect(res.data.message).to.include("Minimum deposit amount is 10 tk");
        });

        it("rejects deposit to a non-existent account", async () => {
            const res = await api.post(
                "/transaction/deposit",
                { from_account: users.agent.phone_number, to_account: UNREGISTERED_PHONE, amount: 100 },
                authHeaders(tokens.agent)
            );
            expect(res.status).to.equal(404);
            expect(res.data.message).to.include("To Account does not exist");
        });
    });

    describe("6. Customer 1 sends 1000 tk to customer 2", () => {
        it("sends 1000 tk and charges 5 tk service fee", async () => {
            const res = await api.post(
                "/transaction/sendmoney",
                { from_account: users.customer1.phone_number, to_account: users.customer2.phone_number, amount: 1000 },
                authHeaders(tokens.customer1)
            );
            expect(res.status).to.equal(201);
            expect(res.data.fee).to.be.a("number");
            expect(res.data.fee).to.equal(5);
        });
    });

    describe("7. Customer 2 cashes out 500 tk via agent", () => {
        it("withdraws 500 tk and charges 1% service fee", async () => {
            const amount = 500;
            const res = await api.post(
                "/transaction/withdraw",
                { from_account: users.customer2.phone_number, to_account: users.agent.phone_number, amount },
                authHeaders(tokens.customer2)
            );
            expect(res.status).to.equal(201);
            expect(res.data.message).to.equal("Withdraw successful");
            expect(res.data.fee).to.be.a("number");
            expect(res.data.fee).to.equal(amount * 0.01);
        });

        it("rejects withdrawing from another customer's account", async () => {
            const res = await api.post(
                "/transaction/withdraw",
                { from_account: users.customer1.phone_number, to_account: UNREGISTERED_PHONE, amount: 500 },
                authHeaders(tokens.customer2)
            );
            expect(res.status).to.equal(404);
        });

        it("rejects withdrawal above the daily limit", async () => {
            const res = await api.post(
                "/transaction/withdraw",
                { from_account: users.customer2.phone_number, to_account: users.agent.phone_number, amount: 50000 },
                authHeaders(tokens.customer2)
            );
            expect(res.status).to.equal(400);
            expect(res.data.message).to.include("Daily amount limit exceeded");
            expect(res.data.details.maxAmount).to.equal(5000);
        });
    });

    describe("8. Customer 2 pays 400 tk to merchant", () => {
        it("pays 400 tk and charges 5 tk service fee", async () => {
            const res = await api.post(
                "/transaction/payment",
                { from_account: users.customer2.phone_number, to_account: users.merchant.phone_number, amount: 400 },
                authHeaders(tokens.customer2)
            );
            expect(res.status).to.equal(201);
            expect(res.data.fee).to.be.a("number");
            expect(res.data.fee).to.equal(5);
        });

        it("rejects payment larger than the balance", async () => {
            const res = await api.post(
                "/transaction/payment",
                { from_account: users.customer2.phone_number, to_account: users.merchant.phone_number, amount: 50000 },
                authHeaders(tokens.customer2)
            );
            expect([400, 403]).to.include(res.status);
        });

        it("rejects payment to a non-existent merchant", async () => {
            const res = await api.post(
                "/transaction/payment",
                { from_account: users.customer2.phone_number, to_account: UNREGISTERED_PHONE, amount: 100 },
                authHeaders(tokens.customer2)
            );
            expect(res.status).to.equal(404);
            expect(res.data.message).to.include("not exist");
        });
    });
});
