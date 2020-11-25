'use strict'
/* eslint-env mocha */

const { expect } = require('aegir/utils/chai')
const sinon = require('sinon')
const AddressManager = require('../../src/address-manager')
const TransportManager = require('../../src/transport-manager')
const Transport = require('libp2p-tcp')
const mockUpgrader = require('../utils/mockUpgrader')
const addrs = [
  '/ip4/127.0.0.1/tcp/0',
  '/ip4/0.0.0.0/tcp/0'
]
const NatManager = require('../../src/nat-manager')
const delay = require('delay')
const peers = require('../fixtures/peers')
const PeerId = require('peer-id')

describe('Nat Manager (TCP)', () => {
  let peerId
  let am
  let tm
  let nm

  beforeEach(async () => {
    peerId = await PeerId.createFromJSON(peers[0])
    am = new AddressManager(peerId, { listen: addrs })
    tm = new TransportManager({
      libp2p: {
        peerId,
        addressManager: am,
        peerStore: {
          addressBook: {
            consumePeerRecord: sinon.stub()
          }
        }
      },
      upgrader: mockUpgrader,
      onConnection: () => {}
    })
    nm = new NatManager({
      peerId,
      addressManager: am,
      transportManager: tm,
      enabled: true
    })

    tm.add(Transport.prototype[Symbol.toStringTag], Transport)
    await tm.listen(am.getListenAddrs())
  })

  afterEach(async () => {
    await nm.stop()
    await tm.removeAll()
    expect(tm._transports.size).to.equal(0)
  })

  it('should map TCP connections to external ports', async () => {
    nm._client = {
      externalIp: sinon.stub().resolves('82.3.1.5'),
      map: sinon.stub(),
      destroy: sinon.stub()
    }

    let observed = am.getObservedAddrs().map(ma => ma.toString())
    expect(observed).to.be.empty()

    await nm._start()

    observed = am.getObservedAddrs().map(ma => ma.toString())
    expect(observed).to.not.be.empty()

    const internalPorts = tm.getAddrs()
      .filter(ma => ma.isThinWaistAddress())
      .map(ma => ma.toOptions())
      .filter(({ host, transport }) => host !== '127.0.0.1' && transport === 'tcp')
      .map(({ port }) => port)

    expect(nm._client.map.called).to.be.true()

    internalPorts.forEach(port => {
      expect(nm._client.map.getCall(0).args[0]).to.include({
        privatePort: port,
        protocol: 'TCP'
      })
    })
  })

  it('should not map TCP connections when double-natted', async () => {
    nm._client = {
      externalIp: sinon.stub().resolves('192.168.1.1'),
      map: sinon.stub(),
      destroy: sinon.stub()
    }

    let observed = am.getObservedAddrs().map(ma => ma.toString())
    expect(observed).to.be.empty()

    await expect(nm._start()).to.eventually.be.rejectedWith(/double NAT/)

    observed = am.getObservedAddrs().map(ma => ma.toString())
    expect(observed).to.be.empty()

    expect(nm._client.map.called).to.be.false()
  })

  it('should do nothing when disabled', async () => {
    nm = new NatManager({
      peerId: 'peer-id',
      addressManager: am,
      transportManager: tm,
      enabled: false
    })

    nm._client = {
      externalIp: sinon.stub().resolves('82.3.1.5'),
      map: sinon.stub(),
      destroy: sinon.stub()
    }

    nm.start()

    await delay(100)

    expect(nm._client.externalIp.called).to.be.false()
    expect(nm._client.map.called).to.be.false()
  })
})
