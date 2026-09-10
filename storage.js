const fs = require('fs');
const path = require('path');

// Simple JSON File-backed database engine mirroring Mongoose collection interface
class FileCollection {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = [];
    this.load();
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
      } catch (e) {
        this.data = [];
      }
    } else {
      this.data = [];
      this.save();
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  async countDocuments(query = {}) {
    return this.find(query).then(res => res.length);
  }

  async deleteMany(query = {}) {
    this.data = [];
    this.save();
    return { acknowledged: true, deletedCount: 0 };
  }

  async insertMany(docs) {
    const inserted = docs.map(doc => ({
      _id: doc._id || Math.random().toString(36).substring(2, 11) + Date.now().toString(36),
      createdAt: new Date(),
      ...doc
    }));
    this.data.push(...inserted);
    this.save();
    return inserted;
  }

  async create(doc) {
    const newDoc = {
      _id: Math.random().toString(36).substring(2, 11) + Date.now().toString(36),
      createdAt: new Date(),
      ...doc
    };
    this.data.push(newDoc);
    this.save();
    return newDoc;
  }

  async findOne(query = {}) {
    const list = await this.find(query);
    return list[0] || null;
  }

  async findByIdAndUpdate(id, update, options = {}) {
    const idx = this.data.findIndex(d => d._id === id);
    if (idx === -1) return null;
    this.data[idx] = { ...this.data[idx], ...update };
    this.save();
    return this.data[idx];
  }

  async findOneAndUpdate(query, update, options = {}) {
    const existing = await this.findOne(query);
    if (existing) {
      return this.findByIdAndUpdate(existing._id, update, options);
    }
    if (options.upsert) {
      return this.create({ ...query, ...update });
    }
    return null;
  }

  async findByIdAndDelete(id) {
    const idx = this.data.findIndex(d => d._id === id);
    if (idx !== -1) {
      const deleted = this.data.splice(idx, 1)[0];
      this.save();
      return deleted;
    }
    return null;
  }

  find(query = {}) {
    let list = [...this.data];

    // Filter logic
    if (query.$or) {
      list = list.filter(item => {
        return query.$or.some(condition => {
          return Object.keys(condition).every(field => {
            const rule = condition[field];
            const val = String(item[field] || '');
            if (rule.$regex) {
              const regex = new RegExp(rule.$regex, rule.$options || '');
              return regex.test(val);
            }
            return val === String(rule);
          });
        });
      });
    }

    if (query.date && query.date.$lte) {
      const lte = new Date(query.date.$lte).getTime();
      list = list.filter(item => {
        const itemDate = new Date(item.date).getTime();
        return !isNaN(itemDate) && itemDate <= lte;
      });
    }

    // Query builder chain
    const chain = {
      sort: (sortObj) => {
        const [field, order] = Object.entries(sortObj)[0] || [];
        if (field) {
          list.sort((a, b) => {
            const valA = a[field];
            const valB = b[field];
            if (valA < valB) return order === -1 ? 1 : -1;
            if (valA > valB) return order === -1 ? -1 : 1;
            return 0;
          });
        }
        return chain;
      },
      skip: (n) => {
        list = list.slice(n);
        return chain;
      },
      limit: (n) => {
        list = list.slice(0, n);
        return chain;
      },
      lean: () => list,
      then: (resolve) => resolve(list)
    };

    return chain;
  }

  async aggregate(pipeline) {
    // Basic sum pipeline support
    let total = 0;
    for (const item of this.data) {
      total += (Number(item.amount) || 0);
    }
    return [{ _id: null, totalRevenue: total }];
  }
}

const dataDir = path.join(__dirname, 'data_store');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

module.exports = {
  ClientStore: new FileCollection(path.join(dataDir, 'clients.json')),
  TransactionStore: new FileCollection(path.join(dataDir, 'transactions.json')),
  EnquiryStore: new FileCollection(path.join(dataDir, 'enquiries.json'))
};
