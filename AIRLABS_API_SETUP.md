# AirLabs API Setup Guide

This guide will help you register for a free AirLabs API key to enable automatic flight data lookup in TravStats.

## 🌟 Features Enabled by AirLabs API

- **Automatic Flight Data**: Enter just a flight number → Get airline, airports, times, gates automatically
- **Real-time Validation**: Verify boarding pass data against actual flight schedules
- **Historical Flights**: Lookup past flights for accurate data entry
- **Free Tier**: 1000 API requests per month (sufficient for personal use)

---

## 📝 Step-by-Step Registration

### 1. Visit AirLabs Website

Go to: **https://airlabs.co/**

### 2. Create Free Account

1. Click on "**Sign Up**" or "**Get API Key**" button
2. Fill in the registration form:
   - Email address
   - Password
   - Company name (optional - you can use "Personal" or your name)
3. Verify your email address

### 3. Get Your API Key

1. Log in to your AirLabs account
2. Navigate to the **Dashboard** or **API Keys** section
3. Copy your **API Key** (it will look like: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`)

### 4. Choose Free Plan

AirLabs offers multiple plans:

| Plan | Requests/Month | Price | Best For |
|------|----------------|-------|----------|
| **Free** | 1,000 | $0 | Personal use, testing |
| Starter | 10,000 | $9.99 | Small projects |
| Professional | 100,000 | $49.99 | Production apps |

**Select the Free Plan** for TravStats personal use.

---

## 🔧 Configure TravStats Backend

### 1. Add API Key to Environment Variables

Open your backend `.env` file:

```bash
cd backend
# Copy the example if you haven't already
cp .env.example .env
```

### 2. Edit `.env` File

Add your AirLabs API key:

```env
# AirLabs Flight Data API (Optional)
# Free Tier: 1000 requests/month
# Get your free API key at: https://airlabs.co/
AIRLABS_API_KEY=YOUR_ACTUAL_API_KEY_HERE
```

**Replace `YOUR_ACTUAL_API_KEY_HERE` with your actual API key!**

### 3. Restart Backend Server

If the backend is running, restart it to load the new environment variable:

```bash
# In backend directory
npm run dev
```

You should see no errors about missing API keys in the console.

---

## ✅ Verify Setup

### Test the API Endpoint

You can test if the API key works by making a request:

```bash
# Test flight lookup (replace LH400 with any flight number)
curl http://localhost:8000/api/v1/flight-lookup/LH400
```

**Expected Response:**
```json
{
  "success": true,
  "count": 1,
  "flights": [
    {
      "flightNumber": "LH400",
      "airline": "Lufthansa",
      "departure": {
        "iata": "FRA",
        "name": "Frankfurt Airport",
        ...
      },
      ...
    }
  ]
}
```

**If you see an error:**
- Check that the API key is correctly added to `.env`
- Verify the API key is valid on AirLabs dashboard
- Check your monthly quota (1000 requests/month)

---

## 📊 API Usage Limits

### Free Tier Limits

- **1,000 requests per month**
- Rate limit: ~3 requests per second
- Historical data: Up to 30 days

### Monitoring Usage

1. Log in to AirLabs dashboard
2. View **Usage Statistics**
3. Track remaining API calls for the month

### Best Practices

To stay within limits:

✅ **Use flight lookup only when needed**:
- User manually enters flight number
- Boarding pass scanner validation

❌ **Avoid**:
- Automatic background lookups
- Repeated lookups for same flight
- Bulk processing without user action

---

## 🔒 Security Notes

### Important Security Rules

1. **Never commit `.env` to Git**
   - Already in `.gitignore` by default
   - Contains sensitive API keys

2. **Don't share your API key**
   - Each developer should have their own key
   - Don't hardcode keys in source code

3. **Production Deployment**
   - Use environment variables in production
   - Never expose keys in frontend code
   - Rotate keys if compromised

---

## 🆘 Troubleshooting

### Error: "API authentication failed"
**Solution**: Check that API key is correctly copied to `.env` file

### Error: "Rate limit exceeded"
**Solution**: You've used all 1000 monthly requests. Wait until next month or upgrade plan.

### Error: "No flights found"
**Solution**:
- Flight number might be incorrect
- Try adding date parameter: `?date=2024-01-15`
- Not all flights are in the database

### Backend doesn't use API
**Solution**:
- Check if `AIRLABS_API_KEY` is set in `.env`
- Restart backend server after changing `.env`
- Check backend console logs for errors

---

## 🔄 Alternative: Running Without API Key

TravStats will work perfectly fine **without** AirLabs API:

- **OpenFlights Database**: 7,681 airports already imported
- **Manual Entry**: Users can enter all flight data manually
- **Boarding Pass Scanner**: Still works for IATA/ICAO codes
- **Airport Enrichment**: Works from local database

The API is **optional** and only adds:
- Automatic flight number lookup
- Real-time flight validation
- Current gate/terminal information

---

## 📚 API Documentation

For advanced usage and more endpoints, see:

- **AirLabs Docs**: https://airlabs.co/docs
- **TravStats API Routes**: See `backend/src/routes/flightLookup.ts`
- **TravStats Flight Service**: See `backend/src/services/flightLookup.ts`

---

## 💡 Next Steps

1. ✅ Get your free API key from https://airlabs.co/
2. ✅ Add it to `backend/.env`
3. ✅ Restart backend server
4. ✅ Test with a flight number lookup
5. 🎉 Enjoy automatic flight data!

---

*Last Updated: 2025-11-22*
*For issues, see: https://github.com/Abrechen2/TravStats/issues*
